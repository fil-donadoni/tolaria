---
name: new-card
description: Generate a CardDefinition for a new MTG card in convex/cards/sets/. Fetches oracle data from Scryfall, maps to the CardDefinition interface, and validates against CR.
argument-hint: "<card name>"
allowed-tools: Bash(curl:*) WebFetch(domain:api.scryfall.com) WebFetch(domain:scryfall.com) Bash(bun run cr:*)
---

# New Card Definition Generator

Generate a `CardDefinition` for a new card in the Tolaria engine.

## Workflow

### Step 1 — Fetch oracle data

Scryfall blocks WebFetch (HTTP 403). Use curl with a User-Agent header:

```sh
curl -s -A "Mozilla/5.0" "https://api.scryfall.com/cards/named?exact={card_name_plus_separated}"
```

Prefer `exact=` over `fuzzy=` to avoid ambiguity. Replace spaces with `+`.

Extract: name, mana_cost, type_line, oracle_text, power, toughness, loyalty.

**Card `id` (mandatory):** the `id` is NOT a fresh UUID. It is the card's
`identifiers.scryfallId` from the set's MTGJSON file under `data/json/<SET>.json`
(the Scryfall card object's own `id` field equals this value). The id is what
maps a card to its art, so an invented UUID silently breaks the image. Pull it
with:

```sh
jq -r '.data.cards[] | select(.name=="<Card Name>") | .identifiers.scryfallId' data/json/<SET>.json
```

The gate's `check:index` (`scripts/check-card-index.ts`) fails if any card `id`
is not in the lockfile `data/card-index.json`, or is not the card's EARLIEST
paper printing (ADR 0041) — so an invented UUID and a reprint's id both fail it.
Do not work around it, fix the id.

### Step 2 — Map to CardDefinition

Use the interface from `convex/cards/types.ts`:

```typescript
export interface CardDefinition {
    id: CardId; // = the card's `identifiers.scryfallId` from the set's MTGJSON file — NEVER generate a fresh UUID
    name: string;
    manaCost?: ManaCost; // { X?, W?, U?, B?, R?, G?, C? }
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    loyalty?: number;
    targetRequirement?: TargetRequirement;
    effects?: EffectOp[]; // Effect Script (ADR 0045) — the DSL-first default
    resolve?: (ctx: SpellContext) => void; // escape hatch, needs justification
    entersTapped?: boolean;
    staticAbilities?: string[];
    activatedAbilities?: ActivatedAbility[];
    triggeredAbilities?: string[];
    sbaMods?: string[];
}
```

`ActivatedAbility` and the triggered-ability shape carry their own `effects?:
EffectOp[]` site alongside `resolve?`/`resolveSteps?` — same DSL-first rule,
same mutual exclusivity.

### Step 3 — Classify complexity

1. **Pure data** — Vanilla creature/land: stats only, no resolve/abilities/effects.
2. **Declarative** — Keywords (flying, trample) go in `staticAbilities[]`. Mana
   abilities use `ActivatedAbility` with `useStack: false`. Spells and
   triggered/activated abilities WITH an effect are written as an **Effect
   Script** (`effects: EffectOp[]`) — see Steps 4–5 below. This is the
   DSL-first default (ADR 0045) and covers the large majority of new cards.
3. **Imperative escape hatch** — `resolve()` (or `resolveSteps`) is for
   **protocol-like cards** whose effect the Op vocabulary genuinely cannot
   express (Word of Command, Camouflage — ~10–15% of the pool). Using it
   requires an explicit recorded justification, see Step 5b.

### Step 4 — Consult the Mechanics Registry (mandatory before writing effects)

`convex/cards/mechanicsRegistry.ts` is the single authority on mechanic names.
Before writing a single Op or `staticAbilities` string, map every clause of
the oracle text against it:

> **Inside a `/new-set` rollout:** Phase 0's sub-agent **C** already produced a
> registry snapshot (implemented keywords + `bindingPattern`s, `planned`/absent
> keywords, the full `EFFECT_OP_REGISTRY` Op list) for the whole set. Reuse it
> instead of re-reading the registry per card — it's the same file N times
> otherwise. Re-read only if the rollout has since flipped a row to
> `implemented` (a cluster shipping its mechanic does exactly that).

- **Keyword abilities** (CR 702 — flying, trample, protection, rampage N,
  landwalk, …): the `staticAbilities[]` string must case-insensitively match
  a registry row's `name`, or its `bindingPattern` for a parametrized keyword.
  Grep the registry for the keyword name to confirm `status: "implemented"`.
- **Keyword actions / effect verbs** (CR 701 — destroy, exile, draw, sacrifice,
  counter, …): the Op you'd use (`EffectOp.op`) must be a row in
  `EFFECT_OP_REGISTRY` in the same file (`isRegisteredEffectOp`). Grep the
  registry for the current, authoritative Op list — it grows over time —
  rather than trusting a stale list in this doc.

**If a clause needs a keyword or Op that is `planned` or absent from the
registry: STOP.** Do not invent a mechanic name, and do not silently reach for
a `resolve()` closure to route around the gap — that is exactly the failure
mode the registry exists to prevent (an agent inventing vocabulary). Instead:

1. Report the gap clearly (which clause, which mechanic is missing).
2. Open a GitHub issue flagging it (or ask the user if mid-session), and
3. Land the card as a commented-out stub (per the existing reprint/stub
   convention) rather than a half-implemented `CardDefinition` — full
   end-to-end implementation or an explicit deferral, never a silent partial.

### Step 5 — Generate the Effect Script

Map each remaining oracle-text clause onto an ordered `effects: EffectOp[]`
list, reusing the four structural constructs where the clause needs them:

- **bind** — name a step's result for a later step to read (`bind: "$target"`)
- **ref** — read a bound object's runtime property (`{ ref: "$target.power" }`)
  or a declaratively-counted set (`{ count: { zone, filter } }`)
- **if** — a predefined predicate (boolean-binding test or numeric comparison),
  never an arbitrary expression
- **forEach** — iterate a declaratively-selected set (`players` in APNAP
  order, or `battlefield` permanents, optionally filtered)

Place `effects[]` at the site the ability actually resolves from:
`CardDefinition.effects` (spell), `ActivatedAbility.effects` (`useStack: true`
abilities), the triggered-ability `effects`. It is mutually exclusive with
`resolve()` / `resolveSteps` / `effect` (the shorthand) on the same site —
combining them fails the catalogue-wide validation sweep
(`convex/cards/__tests__/effectScripts.test.ts`).

#### Step 5b — Falling back to `resolve()` (justification required)

Only when Step 5's mapping genuinely fails to fit the frozen grammar (not
merely because an Op is missing — that's the stop-and-issue case in Step 4)
may the card use `resolve()`. Record why, in two places:

- A code comment on the ability: `// protocol card: <what makes this
structurally imperative>`.
- A line in the PR description restating the same justification.

A `resolve()` closure with no recorded justification is a review blocker.
When falling back, use `SpellContext` primitives: `dealDamage`, `destroy`,
`destroyAll`, `gainLife`, `loseLife`, `exile`, `modifyPower`,
`modifyToughness`, etc. — the same primitive-reuse discipline
(`.claude/rules/gre-development.md` § Primitive reuse) applies before adding a
new one.

### Step 6 — Mana cost conversion

Scryfall format `{3}{W}{W}` → `{ X: 3, W: 2 }`:

- `{N}` → `X: N` (generic/colorless)
- `{W}` → `W: count`, same for U, B, R, G
- `{C}` → `C: count` (true colorless)

### Step 7 — Generate code

Present the complete `CardDefinition` export for `convex/cards/sets/{set}.ts`.

Follow existing patterns in the file (read it first to match style).

### Step 7b — Uncomment matching reprints (mandatory)

After the new `CardDefinition` is in place, search every other set file in
`convex/cards/sets/` for `CardPrint` stubs whose `definitionId` matches the
new card's `id`. Reprints are stored as commented blocks like:

```ts
// export const animateWallLeb: CardPrint = {
//     printId: "5c5b4738-20bb-465d-b67e-c6146dce9d0b",
//     definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // animateWall (stub)
//     setCode: "leb",
// };
```

For every match:

1. Uncomment the entire block (remove the leading `// ` from each line).
2. Drop the trailing ` (stub)` annotation on the `definitionId` line.

Quick locator:

```sh
grep -rn "definitionId: \"<NEW_CARD_ID>\"" convex/cards/sets/
```

This keeps reprint coverage in sync with implementation: as soon as a
`CardDefinition` becomes real, every print that references it goes live in
the registry without a separate follow-up.

### Step 7c — Frontend wiring analysis (mandatory)

A card correct in the GRE can still be dead in the UI: the client never sees
`GameState`, only the output of **view reducers** that can silently drop a
field the card's affordance depends on. This is a recurring bug class — the
card passes every server-side test (GRE unit, wire format, DSL smoke) while no
affordance appears on the board. Walk the reducers before considering the card
done (`.claude/rules/gre-development.md` § Frontend wiring analysis has the
full table):

1. **Activation-cost affordability.** If the card has an `activatedAbility`
   whose `cost` gates on player/board state (`exileFromGraveyard`, `life`,
   `removeCounter`, or a `canActivate` predicate), confirm
   `buildTriggerStateView` (`src/lib/card-utils.ts`) carries the field the gate
   reads and that `getStackAbilities` has a matching gate. The catalogue sweep
   `src/lib/__tests__/activation-affordability.catalogue.test.ts` covers the
   `exileFromGraveyard`/`life`/`removeCounter` shapes automatically — reusing
   one needs no new frontend test. A **brand-new cost shape** must be added to
   that sweep's `Shape` union AND gated in `getStackAbilities`.
2. **New card-instance field or `TargetRequirement.type`.** Confirm
   `projectPublicState` preserves it (add a wire-format test) and, for a new
   target type, run the full target-type table in the rule file.
3. Any SURFACE test you add MUST drive the assertion **through the reducer**
   (`buildTriggerStateView` / `projectPublicState`) — a hand-built view/state
   masks a dropped field and does not count.

### Step 8 — Refresh the card-index lockfile (mandatory)

`data/card-index.json` (ADR 0041) is the committed index of every implemented
card and the only thing the worklist importer (`list-to-cards.mjs`) dedups
against. It does **not** auto-update — adding a card leaves it stale until you
regenerate it from the registry:

```sh
bun run scripts/backfill-card-index.ts
```

(Incremental and idempotent: existing entries are preserved, only missing
scryfallIds are fetched — adding one card costs one Scryfall request, not a
full-catalogue refetch. The full reset — `printf '[]\n' > data/card-index.json
&& bun run scripts/backfill-card-index.ts` — re-downloads everything and is
needed ONLY to purge **pollution** (indexed-but-not-implemented entries),
which the additive backfill can't remove.)

The drift guard `bun run check:index` (part of `check:all`) fails when the
lockfile is out of sync — both directions: implemented-but-not-indexed
(stale → incremental backfill above) and indexed-but-not-implemented
(pollution → full reset). Never hand-edit the lockfile.

### Step 8b — Token / emblem art (mandatory when the card makes one)

If the card creates a **token** (`createToken`) or an **emblem**
(`{ op: "emblem" }`), wire its art — a missing image renders a bare
placeholder (and an emblem trigger once crashed the stack row):

- **Token.** Reuse a `convex/cards/sharedTokens.ts` spec if one fits (it
  already carries `imagePrintId`). Otherwise regenerate the print lockfile so
  the reverse-link resolves the art:
    ```sh
    node scripts/fetch-token-prints.mjs --all   # or the specific set file
    ```
    or pin `imagePrintId` on the spec. A token made from a `resolve()` closure
    is invisible to the DSL art guard — pin `imagePrintId` by hand. The guard
    `convex/cards/__tests__/tokenPrintLookup.test.ts` (#1305) fails CI on any
    DSL `createToken` with no art.
- **Emblem.** Set `imagePrintId` on the `EmblemDefinition` in
  `convex/cards/emblems.ts` — the Scryfall emblem print (`t:emblem`, layout
  `emblem`; the card's own set where present, else a same-characteristics
  substitute). `convex/cards/__tests__/emblemArt.test.ts` fails CI on a
  registered/created emblem with no `imagePrintId`, an unregistered id, or a
  triggered ability missing `oracleText`.

## Validation checklist

- [ ] ManaCost matches Scryfall oracle
- [ ] Types and subtypes match type_line
- [ ] Power/toughness match (creatures only)
- [ ] Keywords mapped to `staticAbilities[]`, cross-checked against the Mechanics Registry
- [ ] TargetRequirement set for targeted spells
- [ ] Effect written as `effects: EffectOp[]` (DSL-first); every Op/keyword used is `status: "implemented"` in `EFFECT_OP_REGISTRY` / the Mechanics Registry
- [ ] `resolve()` used ONLY with a recorded justification comment (`// protocol card: …`) — otherwise absent
- [ ] `bun run test convex/cards/__tests__/effectScripts.test.ts convex/cards/__tests__/effectScriptSmoke.test.ts convex/cards/__tests__/mechanicsRegistry.test.ts` passes with no hand-edits to those files (the catalogue-wide sweeps pick the new card up automatically)
- [ ] `id` == the card's `identifiers.scryfallId` from `data/json/<SET>.json` (NOT a generated UUID)
- [ ] All matching `CardPrint` stubs in `convex/cards/sets/<code>/<colour>.ts` uncommented (Step 7b)
- [ ] Frontend wiring walked (Step 7c): any affordability/target/instance-field the card adds is preserved through `buildTriggerStateView` / `projectPublicState`, and a new cost shape (if any) is added to the affordability catalogue sweep + gated in `getStackAbilities`
- [ ] `data/card-index.json` refreshed via incremental `backfill-card-index.ts` (Step 8) — `bun run check:index` passes
- [ ] If the card makes a token/emblem (Step 8b): `imagePrintId` wired (shared spec, lockfile refresh, or explicit) — `tokenPrintLookup.test.ts` / `emblemArt.test.ts` pass
- [ ] **Any issue this skill opens carries a `## Target files` section** — a plain bullet list of the module/glob paths the work touches (for a card: its `convex/cards/sets/<code>/<colour>.ts`, plus any engine file a capability gap forces). It is scheduling metadata the queue planner parses (`scripts/lib/queue-plan.ts`), not spec: without it the planner refuses to guess the blast radius and runs the issue SOLO, closing the batch around it — measured at 162 issues deferred behind one such ticket. Omit append-only registration points (`convex/cards/index.ts`, `data/card-index.json`); the merge-train absorbs those by design. A WRONG path is worse than a missing one, so widen rather than guess.
- [ ] **Every issue cut from a `prd`-labelled umbrella carries the native sub-issue edge** — `gh issue edit <child> --parent <umbrella>`. Applies whenever this skill publishes a PRD and splits work out of it (capability gap → mechanic slice + card slice), and whenever an issue is turned INTO a PRD: the children get wired in the same pass, never left for later. `/process-gh-issues` sorts its queue by `parent.number ?? number` (oldest **lineage** first) off its cheap Stage-1 list call, so a child with no edge sorts on its own number — a slice cut today from a PRD opened months ago lands at the BACK of the queue and its umbrella never converges. The edge is also what `subIssuesSummary` reads, the only signal that closes the PRD when its last slice lands; a prose `Parent: #N` line is for humans and is NOT the sort key. Verify with `gh issue view <umbrella> --json subIssuesSummary` — `total` must equal the number of children just cut. Only wire `--parent` to a genuine umbrella (carries `prd`, holds no implementation work of its own); for a slice split out of an ordinary WORK ticket use `--add-blocked-by` / `--add-blocking` and leave `parent` unset.

The deck builder's card list is computed in-memory from the colour-split set
modules `convex/cards/sets/<code>/<colour>.ts` on every query call (see
`convex/cardIndex.ts`),
so a new card appears in the builder as soon as the Convex deploy picks up
the new module — no sync step required. The **lockfile** is the one artifact
that needs the explicit refresh in Step 8.
