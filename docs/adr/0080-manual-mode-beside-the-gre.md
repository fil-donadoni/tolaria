# Manual Mode runs beside the GRE, not inside it — and its catalogue is a client asset, not a table

## Status

accepted

## Context

Tolaria plays ~1.9k cards. Everything else — roughly 94% of paper Magic — is
unplayable here, and will stay unplayable for years: a card enters the pool only
when someone implements its mechanics. **Manual Mode** is the answer to that: a
Cockatrice-style seat where no rule is enforced and no action is automated, the
players move cards between zones by hand and agree between themselves on what is
legal. A creature dies because someone drags it to the graveyard; life changes
because someone types a smaller number. In exchange, **every card ever printed is
playable on day one.**

It is meant to run _alongside_ the real engine indefinitely, not to replace it.
That is the constraint that shapes every decision below: the GRE will keep
evolving for a long time, and it must not have to ask "…and what about manual
mode?" on every change.

The obvious implementation is to reuse what exists — run Manual Mode on
`GameState`, with the rules switched off, exposing the affordances already
gated behind the debug panel's `debugAllActions` (right-click a library →
Draw / Mill / Exile, wired to `drawCard` / `mill` / `exileFromLibrary` in
`convex/game.ts`). That reuse is an illusion, and one measurement kills it:

```
getDefinition(cardId)  →  throw new Error(`Card not found: ${cardId}`)   convex/cards/index.ts:552

throwing getDefinition() call sites in convex/gre + game.ts + gameProjections:  47
tryGetDefinition() call sites (degrade silently):                              196
```

A card with no `CardDefinition` — again: the entire point of Manual Mode — put
into a real `GameState` crashes the server in 47 places and silently degrades in
196 more. This is not gateable behind a flag: SBAs, the layer system, the
projections and the trigger scan all _must_ hydrate the definition to do their
job. Reusing `GameState` therefore restricts Manual Mode to the 1.9k cards the
engine already plays, which is the one thing it exists to escape.

A second question rides along. The deck builder needs to search the full card
universe, which the registry does not contain. Measured on the Scryfall
`oracle_cards` bulk (38,431 oracle rows; 36,279 paper; **32,331** after
excluding tokens, art series, schemes, planes, vanguards and emblems):

| Shape of the reduced catalogue                    | raw     | **gzip**    | B/card |
| ------------------------------------------------- | ------- | ----------- | ------ |
| array of objects, long keys                       | 7.95 MB | 2288 KB     | 258    |
| array of objects, short keys                      | 6.03 MB | 2219 KB     | 195    |
| columnar                                          | 4.58 MB | 1852 KB     | 148    |
| **columnar, no `oracleId`, UUIDs without dashes** | 3.25 MB | **1126 KB** | 105    |
| columnar, also without type line                  | 2.53 MB | 1037 KB     | 82     |
| name + print id only                              | 1.69 MB | 886 KB      | 55     |
| _(reference)_ `oracle_text` alone                 | 5.02 MB | 1065 KB     | 163    |

The floor is entropic, not a matter of encoding: 32,331 print UUIDs are
32,331 × 16 B = **517 KB that no compressor can touch**, which is why even the
name-plus-id variant sits at 886 KB. Printings make it worse — ~97k of them,
≥1.55 MB of pure UUID entropy, roughly tripling the download to support a
picker a player opens once in a while.

For comparison, the app today ships **431 KB gzip of card catalogue inside the
main bundle, on every page load, to everyone** (`esbuild --bundle --minify` of
`convex/cards/index.ts` = 1.63 MB raw / 431 KB gz for 1872 cards ≈ 873 B/card),
because `src/lib/images.ts` and ~20 board components import `getDefinition`.

## Decision

### 1. Manual Mode has its own state, its own mutations, and its own board

- `ManualGameState` lives in its own tables (`manualStates`, `manualLog`), with
  its own mutations in **`convex/manual.ts`**, which imports **nothing** from
  `convex/gre/`. An import-graph guard test enforces this, on the model of
  `scripts/__tests__/bot-suite-boundary.test.ts` — a convention alone erodes at
  the first "just this once".
- The **only** coupling paid by the real engine is three lines in
  `createGame` / `joinGame` / `createSoloGame` rejecting a `manual`-format deck.
  `convex/gre/**` gains zero lines.
- Everything else is reused where reuse is real: the `matches` / `games` rows and
  therefore the whole lobby, invite-link and join flow (Bo1 and Bo3 alike); and
  the **presentational** frontend — `CardImage`, `CardPreview`, `CardBack`,
  `BoardCard`, the piles, `attached-cards-cluster`, `board-arrows`,
  `rowLayout` / `splitRowLayout`, and both band modules
  (`portrait-board-bands.ts`, `landscape-board-bands.ts`, which are pure).
  `CardImage` already accepts `CardInstance | { id: string }` and hydrates
  through the null-safe `tryGetDefinition`, so it renders a definition-less card
  unchanged — and the preview shows the printed card image, so the oracle text
  is legible without a definition.
- What is **not** reused is the interaction layer: `useBattlefieldInteraction`
  (1042 lines of cast / activate / target / attack) has no meaning here. Manual
  Mode's ~16 verbs (move, tap, untap-all, life ±, counter ±, face-down, lane,
  attach, arrow, draw, mill, exile, peek, shuffle, token, roll, note, phase) are
  5–15-line reducers precisely because none of them validates anything.
- A `ManualCardInstance` is deliberately shaped as a subset of `CardInstance`
  (`id`, `card: { id }`, `zone`, `controllerId`, `ownerId`, `isTapped`,
  `faceDown`, `lane`, `counters`, `attachedTo`, `note`) so the presentational
  components take it as-is.

Deliberate non-goals, each rejected for a stated reason:

- **No free x/y card positioning.** The battlefield keeps the automatic layout
  plus one `lane: "main" | "combat"` field. Free coordinates look more expressive
  but produce a second layout system to maintain forever, against the premise
  that the real engine keeps evolving. Blocks and attachments are expressed by
  explicit verbs (arrow, attach), which read better than position anyway.
- **No inferred game state.** No "this creature has lethal damage" highlight, no
  automatic damage clearing, no mana pool. The moment the system knows what
  toughness is, it must hydrate a definition, and it is blocked on 94% of the
  catalogue again. Explicit player-invoked conveniences (a dedicated `damage`
  counter, an "End turn" button that clears it, "untap all") are fine — they
  decide nothing.
- **No undo.** Every verb is already reversible by hand. Shuffle is the sole
  exception and gets a confirmation.
- **No win detection.** A game ends by **concede** only — which is also how it
  works at a real table. The sideboard is a permanently visible zone, not a
  between-games dialog: the dialog exists in the real engine to _enforce_ the
  15-card limit, an enforcement that is meaningless here.

### 2. Hidden information is still server-enforced

Manual Mode is trust-based about _rules_, never about _information_: a hand that
crosses the wire is a hand anyone reads in devtools, which makes the mode
worthless for real play. `projectManualState(state, viewerId)` mirrors
`projectPublicState` on a far simpler state (~60 lines): opponent hand → `null[]`,
library → `{ count }`, `faceDown` cards visible only to their `knownTo`, plus an
explicit `revealedTo: playerId[]` for the _reveal_ verb (Duress, "look at what
I'm drawing"), without which players end up photographing their screens.

### 3. The Full Catalogue is a generated client asset, not a Convex table

The full card universe ships as a **versioned, generated, gzipped columnar
asset** (the 1126 KB variant above), fetched lazily on entering the deck builder
and cached by the browser. Alternate printings are **not** in it: they are
fetched per card, on demand, when a player opens the edition picker —
`/cards/search?q=!"<name>"&unique=prints` is one request and needs no
`oracleId`, which is what makes dropping `oracleId` (−726 KB gz) free. Oracle
text is not in it either: the printed image already shows it, and a text search
in Manual Mode is delegated to the Scryfall API. Tokens **are** in it (~1196
rows, ~4 KB) — a manual client without tokens is unusable.

A Convex table was rejected on capability, not on effort. The deck builder's
filters (`useCardSearch.ts`) need colour identity in three modes, all/any
multi-selects over types and sets, mana-value sets, and cube intersection —
Convex index `filterFields` do equality on a scalar, with no array-contains and
no OR. Worse, a filter query with no text term is a table scan, and 30k
documents does not fit inside a single query's read budget. And it would move a
cost that is **zero today** (in-memory filtering over a local array) onto a
per-keystroke function call plus bandwidth, for every user, forever — the exact
direction PRD #1776 is pulling away from. The intuition that "a DB is faster"
inverts here: the dataset is ~4.5 MB, read-only, and changes every couple of
months.

The corollary is that the deck builder gains a **mode flag**. In manual mode
every result is selectable; in real mode a card with no `CardDefinition` renders
dimmed and unselectable (an **Unavailable Card**, derived at read time by
folded-name match against the registry — `CardIndexRow` carries no `oracleId`),
with a "hide unavailable" filter defaulting to **on** so building real decks
does not get worse. This is also a development instrument: the miss set _is_ the
census of what is not implemented, filterable by colour, type and mana value.

## Consequences

- The real engine keeps exactly one seam to Manual Mode: three rejection lines.
  `convex/gre/**` never learns the mode exists.
- The shared **presentational** components now have two consumers, so changing
  their signatures costs twice. Accepted — it is also what keeps the two modes
  visually coherent.
- Manual Mode inherits nothing automatically. A new mechanic in the GRE does not
  appear here, and does not need to.
- The catalogue asset grows with every set. A CI budget guard (1.5 MB gz against
  1.13 measured) turns today's load test into a permanent constraint; sharding
  is the answer when it is eventually breached, not now.
- Two runtime dependencies on the Scryfall API (alternate printings, oracle-text
  search in manual mode) need an explicit degradation path: the rest of the
  builder must keep working when it is unreachable.
- `manual` becomes a `FormatId`. A manual deck is rejected by real games; a real
  deck plays fine in a manual game, because both address cards by the same print
  id space — `CardDefinition.id` **is** a Scryfall print UUID.
