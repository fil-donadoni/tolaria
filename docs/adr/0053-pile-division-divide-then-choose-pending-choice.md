# Pile division as a two-step divide-then-choose pending choice

## Context

Invasion (INV) introduces a recurring templated interaction — one player
separates a set of objects into **two piles**, then _another_ player chooses one
pile, and an effect applies asymmetrically to the chosen vs. unchosen pile. Six
cards share the exact shape:

| Card             | Object set                          | Divider  | Chooser        | Chosen pile          | Other pile            |
| ---------------- | ----------------------------------- | -------- | -------------- | -------------------- | --------------------- |
| Fact or Fiction  | top 5 cards of your library         | you      | an opponent    | → your hand          | → your graveyard      |
| Do or Die        | all creatures target player controls| you      | that player    | destroyed (no regen) | (survive)             |
| Death or Glory   | all creature cards in your yard     | you      | an opponent    | exiled               | → battlefield         |
| Bend or Break    | each player's nontoken lands        | each pl. | one opponent   | destroyed            | tapped                |
| Fight or Flight  | opponent's creatures                | you      | that player    | may attack           | can't attack          |
| Stand or Fall    | defending player's creatures        | you      | that player    | may block            | can't block           |

Three facts about the existing engine shape the decision:

1. **No divide/partition primitive exists.** The `PendingChoiceKind` taxonomy
   (`gre/types.ts`) covers `ZonePick`, `YesNo`, `LandEntry`, `Order`,
   `OptionChoice`, `NameCard`, `RandomReveal` — a min..max _selection_ from a
   set, or an _ordering_ of a set. None expresses "assign every object in the
   set to one of two piles" (a total 2-way partition), and none carries a
   _second_ decision by a _different_ player over the same object set.

2. **The interaction pauses for input twice, by two players.** The divider acts,
   the game pauses, then the chooser acts — with the pile assignments and the
   still-to-run per-pile effect surviving the pause. Priority and
   serialization (`serialize.ts`) sit between the two submissions.

3. **The per-pile effect varies per card** — destroy, exile, return, tap,
   grant "can't attack/block" for the turn. The chosen and unchosen piles each
   take a _different_ effect. Only the divide/choose _protocol_ is shared; the
   outcomes are ordinary already-shipped operations.

Extract-after-second (project convention) makes six cards a clear mandate to
build one shared mechanism rather than six `resolve()` closures.

## Decision

Model pile division as **one new `EffectOp` (`divideIntoPiles`) that drives a new
two-step `PendingChoiceKind` family (`DividePilesKind`)**, riding the existing
persisted `pendingChoices` array rather than a new top-level `GameState` field.

- The Op declares: the **object set** (an object selector), the **divider** and
  **chooser** players (player selectors — Bend or Break makes each player a
  divider against an opponent chooser), and a **per-pile effect** for the
  **chosen** and **other** piles (each an ordinary `EffectOp[]`, so the outcomes
  reuse `destroy` / `exile` / `moveZone` / `tapUntap` / restriction grants).
- Step 1 raises a `divide-piles` pending choice for the divider: a total 2-way
  partition of the object set. Its payload carries the object ids, the running
  A/B assignment, and the deferred chooser + per-pile continuation.
- Step 2 raises a `pick-pile` choice for the chooser (A or B). On submit, the
  interpreter runs the chosen-pile effect over one pile and the other-pile
  effect over the other.
- The continuation state (pile assignments + the two deferred effect bodies)
  lives **on the pending-choice entry payload**, which is already inside the
  persisted `pendingChoices` array — so no new `PERSISTED_OPTIONAL_KEYS` entry,
  but the payload shape earns a `serialize` round-trip test.

## Consequences

- **One Op, six cards, DSL-first.** All six INV pile cards are Effect Scripts;
  none needs `resolve()`. Later pile-division cards (Fact or Fiction is
  reprinted widely) inherit the Op for free.
- **The exhaustiveness obligations are load-bearing and must all be paid.**
  Adding a `PendingChoiceKind` family forces updates to every exhaustive
  `Record<PendingChoiceKind, …>` site (`gre/state.ts`), the bot-driver dispatch
  (`botActionRealisation` — compile-time exhaustive by standing rule, so a new
  kind is a compile error until handled), `expectedInput`, `legalActions`,
  `pendingChoiceSubmit`, and the client label map
  (`src/lib/pending-choice-labels.ts`). Missing any one silently strands the
  interaction (correct server-side, dead in the UI or the bot).
- **Hard to reverse.** The partition submission shape and the two-step choice
  contract cross GRE → `game.ts` → UI → bot and are persisted mid-flight;
  changing them later is a migration, not a refactor. That — plus the genuine
  alternative (six `resolve()` closures) rejected for a specific reason — is why
  this is an ADR.
- **Alternative rejected — one combined choice.** Collapsing divide+choose into
  a single submission fails: the two decisions belong to _different players_ and
  the chooser must see the divider's completed piles before choosing. The pause
  between them is intrinsic to the mechanic, not an implementation artifact.
