---
title: No cast-time "spend mana as though it were mana of any color" seam exists in the engine
discoveredBy: 1872
status: triaged
issue: 2890
confidence: high
---

> **SHIPPED 2026-08-28 in #2890.** The seam exists: `substitutionsForBreadth`
> (`convex/gre/manaColors.ts`) generates the pairs, `getManaSubstitutions`
> (`convex/gre/state.ts`) returns them for a named cast, and North Star +
> Robber of the Rich both consume it. Nothing here is open work any more —
> the file is kept only so the reasoning below is not re-derived.
>
> **CORRECTED 2026-08-28 — the central claim below was wrong, and the finding is
> now ticketed as #2890.** The draft concluded "there is no almost-right
> primitive to generalize, so this is a new seam, not a parametrization." It
> **is** a parametrization. Read the correction first; the original draft is
> kept underneath because its file-level evidence is still accurate and useful,
> only its conclusion was not.
>
> **1. The primitive exists and is already threaded through every payment
> consumer.** `isManaCostCovered` (`state.ts:21838`), `payManaCost` →
> `payColoredRequirements` → `payHybridPips` → `assignHybridPips`
> (`state.ts:20773-20833`) and `solveAutoTap` / `solveAutoTapPartial` (e.g.
> `game.ts:1248`) **all already take and honour a `substitutions` argument of
> exactly this type.** The draft's observation that `payColoredRequirements`
> has "no wildcard branch" is true but not the obstacle it looked like: a
> wildcard is unnecessary, because "as though any colour/type" is simply a SET
> of concrete `{from, to}` pairs.
>
> **2. No type widening is needed.** `Color` is already
> `"W"|"U"|"B"|"R"|"G"|"C"` (`convex/cards/types.ts:28`) and `MANA_COLORS` is
> already 6-wide (`convex/gre/manaColors.ts:14`); `payColoredRequirements`
> iterates `MANA_COLORS` (`state.ts:20781`), so `{C}` pips already pass through
> the substitution branch. Any **type** = `from ∈ 6, to ∈ 6`; any **color** =
> `from ∈ 6, to ∈ 5`, with `"C"` never a target. Two pair-generators over one
> existing type.
>
> **3. The ~9-consumer estimate collapsed, because the cost does not change.**
> CR 609.4b: _"this affects only how the player may pay a cost. **It doesn't
> change that cost**, and it doesn't change what mana was actually spent to pay
> that cost."_ The draft's consumer list (`gameProjections.ts`,
> `opValuers.ts`, `exile-cast-button.tsx`, `player-exile.tsx`) was derived from
> the assumption that `castRawManaCost` gains a recolour branch. It does not.
> The real gap is ONE function: `getManaSubstitutions` (`state.ts:21775`) reads
> only battlefield statics and has no per-cast channel. Fold the grant into it
> and its ~38 callers inherit it — server, bot valuation and UI alike.
>
> **4. The draft's own bar for cutting a ticket was already met.** It says
> "exactly one shipped card reaches the clause" and sets the bar at "a SECOND
> card wants the same clause". There are **three**, in three different sets,
> each having diagnosed this gap independently:
> **Robber of the Rich** (`eld/red.ts:43`, shipped, clause inert);
> **North Star** (`leg/colorless.ts:106`, commented-out stub, "any **type**",
> blocked on **nothing else** — the seam ships it outright);
> **Agatha's Soul Cauldron** (`woe/colorless.ts:9`, commented-out stub,
> activation-time, also blocked on ability-copy-from-exile, #1324).
>
> **5. "any type" includes colorless; "any color" does not.** Settled by
> explicit rule, not inference — CR 118.14 (_"'mana of any type can be spent' …
> means that players may spend mana as though it were colorless mana or mana of
> any color"_), CR 106.1b (six **types**, colorless included) vs CR 105.1 (five
> **colors**), CR 107.4c (`{C}` is _"a cost that can be paid only with one
> colorless mana"_), CR 107.4h (_"Snow is neither a color nor a type of mana"_,
> so `{S}` stays out). The observable consequence — a `{C}` pip is payable with
> coloured mana under "any type" but **not** under "any color" — is #2890's
> discriminating test. North Star's wording was verified against
> `data/oracle-corpus.json.gz`: it really does say "any **type**".
>
> **Lesson worth keeping:** "no wildcard branch exists" is not the same as "no
> primitive exists". A parameter list already plumbed to every consumer is the
> primitive; check what the callers already accept before concluding a seam is
> missing.

---

## Original draft (conclusion superseded above)

**What is wrong.** Robber of the Rich's Oracle line ends "...you may cast that
card and **you may spend mana as though it were mana of any color** to cast that
spell." The clause is not modelled: the exiled card is castable only for its
normal, unfixed mana cost, so an off-colour exile is uncastable when the card
says it should not be. Issue #1872 finding 2 pre-declared this a stop-and-issue
case rather than a card-local patch, and the investigation below confirms why —
there is no almost-right primitive to generalize, so this is a new seam, not a
parametrization.

**Evidence — what exists.** The only mana-substitution shape in the engine is a
fixed `{ from, to }` pair carried by a **battlefield static effect**:

- `convex/gre/state.ts:19757` — `ManaSubstitution = { from, to }` (CR 609.4b).
- `convex/gre/state.ts:20776` — `getManaSubstitutions`, gathered off permanents
  on the battlefield. There is no per-cast grant channel at all.
- `convex/gre/state.ts:19770` — `payColoredRequirements` / `payHybridPips`: no
  wildcard branch; every path resolves a concrete colour.

The adjacent-looking things are not this. `convex/gre/tapManaBonus.ts:95,110,140,155`
— `kind: "anyColor"` is a **mana-ability production** bonus (what a land taps
for), not cast payment. `convex/gre/payWith.ts`, `convex/gre/paymentPicks.ts`,
`convex/gre/owedPayment.ts` are convoke/delve/improvise: fixed-shape alternative
payments, not a recolouring of ordinary mana.

**Evidence — where the seam would have to go.**

- `convex/game.ts:2739` — `castRawManaCost` is the ONE cost-computation site.
  It already branches on `castFromExileWithoutPayingManaCost`, Madness and
  Bolas's Citadel; a recolour branch would join them.
- `convex/gre/state.ts:1167` — the exile-cast permission record, and
  `convex/gre/state.ts:14568` `grantCastFromExile`, whose `opts` today carry only
  `withoutPayingManaCost` / `includesLand`. The permission is where a per-grant
  "any colour" flag would live.
- Readers that would ALL need the new signal, or silently fail open on it:
  `convex/gameProjections.ts:73,506,548,1088,1099,1337,1345`;
  `convex/gre/ai/opValuers.ts:656,735,749,1110,1271`; `src/types/game.ts:383-400`;
  `src/components/board/exile-cast-button.tsx:8,40`,
  `src/components/board/player-exile.tsx:131`,
  `src/components/board/board-battlefield-card.tsx:490`.

That is ~9 payment/affordability consumers across server, bot valuation and UI —
the shape the "cost-payment consumers span client+server" note warns about, where
a server-only fix reads as done and leaves the bot freezing or the client
offering a cast it cannot pay.

**Why it may not deserve its own issue.** Exactly one shipped card reaches the
clause today, and only in the minority line where the exiled card is off-colour;
the common in-colour case already works, so the observable cost is one dead
affordance on one card. A ticket is worth cutting when a SECOND card wants the
same clause — "spend mana as though it were mana of any color" is common on
Cascade-adjacent and treasure-adjacent designs, and the moment two cards need it
the seam pays for itself. Until then this is arguably a line on the #963 audit
tracker rather than a ticket of its own. The counter-argument: the seam is the
same one a per-cast cost modifier of any kind needs, so building it once unlocks
a category, and leaving it undone means the next card that wants it re-does this
investigation from scratch.
