# 0078 — Sagas: `chapterAbilities` desugared at the `getDefinition` seam, `finalChapter` from EFFECTIVE abilities, CR 2026 "has chapter abilities" gates

## Status

Accepted. Design record for the Saga framework (CR 714) and its first two
consumers, History of Benalia (dom) and Urza's Saga (mh2). Builds directly on
ADR 0054 (implicit keyword expansion at the `getDefinition` seam;
`COUNTER_REMOVED` as a first-class trigger event) and reuses the
`COUNTER_ADDED` / `counterAddedTrigger` foundation shipped by issue #1319,
which until now had **zero consumers**. Resolved in a design session before any
code was written.

## Context

Nothing about Sagas exists in the engine: `grep -i saga` over `convex/` returns
nothing, there is no CR 714 reference anywhere, and no card in the catalogue
carries the `Saga` subtype. What _does_ exist is almost all of the machinery a
Saga needs, built for other reasons:

- `CardInstanceState.counters` is a free-form `Record<string, number>`, so
  `lore` is an ordinary counter with no schema change.
- `COUNTER_ADDED` carries `added` and `total` (`cards/types.ts:6442`), which is
  exactly the before/after pair CR 714.2b's chapter condition needs.
- `counterAddedTrigger` (`cards/abilities/triggers/counterAddedTrigger.ts`) is
  the declarative factory over that event, shipped and unused.
- ADR 0054 established the memoized `getDefinition` wrapper as the place a
  declared mechanic is expanded into `entersWith` + synthesized triggers.
- `effectiveTriggeredAbilities` (`gre/copy.ts:88`) already returns `[]` for a
  permanent under a "loses all abilities" suppression.
- Layer 4 **materializes** subtypes onto `card.subtypes`, so
  `card.subtypes.includes("Saga")` is already the post-layers answer.

Three facts made the design non-obvious enough to record.

**1. CR 714 was rewritten between the 2025-02-07 and 2026-06-19 rules, and the
rewrite inverts the interaction everyone remembers.** Both the turn-based lore
counter (714.3c) and the sacrifice SBA (714.4) now apply only to _"a Saga
permanent **with one or more chapter abilities**"_, and 714.3a became an
intrinsic ability generating a replacement effect rather than an as-enters
action. The old rules had no such gate, so a Saga stripped of its abilities had
a final chapter of 0, trivially satisfied `lore >= 0`, and was sacrificed
immediately — the famous "Blood Moon kills Urza's Saga" ruling. Under the
current rules it is **not** sacrificed and simply persists, inert. An
implementation written from memory, or from the pre-2026 CR, gets this exactly
backwards.

**2. Printed Saga reminder text contradicts the CR and was never re-cut.** Every
Saga on Scryfall, including cards printed years after the change, still reads
_"(As this Saga enters and after your draw step, add a lore counter…)"_. The
rule has been "as a player's precombat main phase begins" since Dominaria
United.

**3. Tolaria places triggers on the stack BEFORE the SBA sweep**, the reverse of
CR 117.5. `resolveTopOfStack` (`gre/state.ts:3814`) is resolve →
`processPendingActionTriggers`, and every caller runs `checkStateBasedActions`
afterwards. CR 714.4 says "has triggered but not yet left the stack" — not "is
on the stack" — precisely because under 117.5 ordering there is a window where
the final chapter has triggered and is not yet stacked. Tolaria's inversion
closes that window structurally.

## Decision

### 1. `chapterAbilities[]` is a first-class `CardDefinition` field, desugared at the `getDefinition` seam

A Saga declares `chapterAbilities: [{ chapters: number[], oracleText, effects }]`.
A memoized wrapper at the single `getDefinition` choke point (the ADR 0054
pattern) expands each entry into a `counterAddedTrigger`-built
`TriggeredAbility`, tagged with its `chapterNumbers`, and injects the
`entersWith` lore counter.

Rejected: **hand-written `triggeredAbilities` per card** — every author would
re-derive the "was less than N and became at least N" condition by hand, three
times per card, which is the `fading 3` desync ADR 0054 exists to prevent.
Rejected: **a `staticAbilities: ["saga"]` keyword string parsed like `fading N`** —
a chapter carries an _effect body_, not a scalar, so there is nothing to parse
out of a string.

`chapters: [1, 2]` expresses CR 714.2c ("I, II —") natively as one ability, in
line with the multi-event `TriggeredAbility` standard that already forbids
emitting near-duplicate abilities for one Oracle line.

### 2. `finalChapter` is derived from EFFECTIVE abilities, never from printed text

`finalChapter(card)` reads `effectiveTriggeredAbilities(card)`, filters the
chapter-tagged entries and takes the max (CR 714.2d). Deriving it means an
author cannot write `finalChapter: 3` on a two-chapter card, and chapter-ness
travels with the ability through copy, grant and suppression for free.

The tag is load-bearing twice over: it is also how the CR 714.4 SBA recognises
_a chapter ability of this Saga_ on the stack, as against any other trigger
sourced from it (a granted trigger via `triggeredGrantTemplates` must not defer
the sacrifice).

### 3. Both CR 714 gates are "has at least one effective chapter ability"

The turn-based lore counter (714.3c) and the sacrifice SBA (714.4) each test
that the Saga has ≥ 1 effective chapter ability before doing anything. The
degenerate `finalChapter === 0` branch is therefore unreachable in both.

Consequence, stated because it looks like a bug: **a Saga under Blood Moon or
Humility is not sacrificed.** It keeps the lore counters it had, stops
advancing, and sits on the battlefield as (for Urza's Saga) a Mountain that taps
for {R}. This is the current rules working correctly, not a regression, and it
is the opposite of the widely-remembered pre-2026 behaviour.

### 4. Saga identity is the `Saga` subtype, not "has chapter abilities"

`card.subtypes.includes("Saga")`. CR 714.2d explicitly contemplates a Saga with
no chapter abilities, so the two cannot be the same test. Note that
`Enchantment Land — Urza's Saga` is **two** subtypes, `["Urza's", "Saga"]` —
"Urza's" is a land type (CR 205.3i) and "Saga" an enchantment type (CR 205.3h).
Authoring it as the single string `"Urza's Saga"` produces a card that is not a
Saga at all: no lore counters, no chapters, no sacrifice, and every server-side
test still green.

### 5. The CR 714.4 SBA scans the stack only, and depends on the trigger-before-SBA ordering

No `pendingChapterTrigger` marker on the instance. A marker would be a second
source of truth for "is a chapter ability in flight", needing correct clearing
on every exit path (resolved, countered, fizzled, source left play), and a stale
one means a Saga that never dies — a worse failure than the one it guards
against. The ordering invariant from Context (3) is defended by a regression
test asserting that a Saga reaching its final chapter still resolves that
chapter before being sacrificed, plus a comment at the SBA naming the
dependency.

### 6. The chapter condition is a TRIGGER condition, not an intervening-if

"…if the number of lore counters on it was less than N and became at least N"
is evaluated once, at trigger time, off the event payload
(`total - added < N && total >= N`). It is never re-checked against live
counters at resolution — doing so would make removing lore counters in response
to a chapter ability fizzle it.

### 7. `applyEntersWithCounters` emits `COUNTER_ADDED`

The entry-counter path (`gre/state.ts:4555`) mutated `card.counters` inline and
emitted nothing, while `addCounterToCard` emitted. Without the event a Saga's
chapter I never triggers — silently, since no server-side test collects a
trigger that is never emitted. Emitting from the entry path is CR-correct in
general (counters put on as a permanent enters are put onto it, and
"whenever one or more counters are put on…" abilities do fire), and its blast
radius is measurably zero: `counterAddedTrigger` has no consumers today.

Rejected: emitting only for `lore` counters (card-shaped); and hanging chapter 1
off `PERMANENT_ENTERED` instead, which breaks Read Ahead (entering with N
counters must fire chapters 1..N) and the enters-with-zero case.

### 8. Two supporting primitives, both generalisations of existing seams

- **`grantActivatedAbilityPermanent`** — `grantAbility`'s activated leg
  currently _requires_ a `duration` (`gre/effects/validate.ts:2511`), an
  asymmetry the code documents as a consequence of the missing indefinite
  primitive rather than a design choice (the keyword leg has had
  omitted-is-indefinite since #1746). Urza's Saga I/II are indefinite
  resolution-generated grants (CR 611.2c). Closing the asymmetry also requires
  `getActivatedManaAbility` (`gre/constants.ts:913`) to read the EFFECTIVE
  ability set rather than only `cardDef.activatedAbilities` — chapter I grants a
  _mana_ ability, and no card in the catalogue has ever granted one, so the gap
  is latent rather than a live bug. `getEffectiveActivatedAbilities` moves down
  from `convex/game.ts` to a GRE-level module so the leaf `gre/constants.ts` can
  reach it without an import cycle.

    Rejected: modelling the grants as counter-gated `activated-grant` statics. A
    chapter is a triggered ability that _resolves_; a static gated on `lore >= N`
    grants the ability even when the trigger is countered, and revokes it when
    counters are removed. Wrong in both directions.

- **`manaCostEquals: ManaCost | ManaCost[]`** on `EffectCardFilter` — Urza's
  Saga III reads "an artifact card with **mana cost** {0} or {1}", which is not
  mana value. `manaValueAtMost: 1` wrongly admits **141** cards: 18 with `{X}`
  costs (Chalice of the Void, Engineered Explosives — both Vintage Cube staples
  and both textbook "no, Saga can't fetch that" rulings) and 123 coloured
  mana-value-1 artifacts. `ManaCost` already distinguishes the cases (`X` holds
  the variable marker `"X"` when the cost is `{X}`, a number when it is
  generic), so exact structural comparison is available. Array = OR, mirroring
  `subtype`'s existing array semantics and `manaValueEquals`'s shape.

    This field **must** be threaded fail-closed through `isCardFilter`
    (`gre/effects/validate.ts:193`): chapter III searches `zone: "library"`, and
    an unthreaded filter field fails _open_ on hidden-zone selectors — a tutor
    that matches every card in the library.

### 9. Deferred, deliberately

- **Read Ahead** (CR 702.155) stays `status: "planned"` in the Mechanics
  Registry, where it already is.
- **Saga creatures** (CR 714.1a, new in the 2026 rules) are out of scope. The
  next consumer is known and already in the pool: Fable of the Mirror-Breaker is
  in `vintageCubeNames.ts`, and permanent-level transform shipped in ADR 0067.
- **`entersWith` suppression under ability-loss.** _(Resolved by issue #1882 —
  the gate now lives at `applyEntersWithCounters` and covers every entry site;
  the divergence marker in `cards/abilities/sagas.ts` is gone. The paragraph
  below is kept as the record of why it was deferred out of the Saga slice.)_
  714.3a is now an intrinsic
  ability, so a Saga entering while Blood Moon or Humility is already out should
  enter with _zero_ lore counters; `entersWith` is read from the definition with
  no suppression gate. Shipped ungated with a tracked divergence marker. The
  correct fix is a probe at `applyEntersWithCounters` covering every consumer
  (fading, vanishing, ravenous, Arwen) — a pre-existing engine gap this card
  merely reveals, and the wrong thing to bolt onto a Saga slice. Filed
  separately. The divergence is one counter on an already-inert permanent: the
  other two gates are correctly ability-conditioned, so the Saga still ends up
  unsacrificed and non-advancing.
- **Blood Moon's `subtype-set`** (`cards/sets/drk/red.ts:88`) replaces _all_
  subtypes; CR 305.7 removes only the land types. "Saga" is an enchantment type
  and should survive. No effect on the sacrifice (both gates are closed without
  chapter abilities regardless), so filed separately rather than blocking.

## Consequences

- Sagas are the **first consumer** of issue #1319's `COUNTER_ADDED` /
  `counterAddedTrigger` foundation, and decision 7 completes its missing ETB
  half.
- No new Effect Script Op is introduced anywhere in this work —
  `manaCostEquals` is a filter field and the indefinite grant is a primitive
  under the existing `grantAbility` Op — so the seven-registry Op checklist does
  not apply, and the bot gains no new choice kind to dispatch (chapter abilities
  resolve on their own; chapter III reuses the existing `search-library`
  choice).
- Urza's Saga is the catalogue's first multi-type `Enchantment Land`. CR 305.9
  is already enforced — every cast branch in `gre/rules.ts` is guarded by
  `!types.includes("Land")` — so it is playable only as a land, with no new work.
- Lore counters render with no UI work: `src/lib/counters.ts` is generic over
  counter type. Granted activated abilities already surface in
  `getStackAbilities` (`src/lib/card-utils.ts:1499`).
- A Saga's `oracleText` stays verbatim Scryfall, stale reminder text included,
  so the catalogue keeps matching its provenance source. The visible consequence
  is a card whose printed parenthetical says "after your draw step" while the
  counter lands at precombat main — detectable only for a Saga that enters or
  changes control during the active player's own draw step.
