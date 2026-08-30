// The per-kind K table for the CAST-side payment parks (ADR 0091 decision 4,
// issue #2135).
//
// A payment park (see `owedPayment.ts`) is a mandatory cost-payment decision
// suspended inside the announcement window: which permanent to sacrifice, which
// card to discard or exile. The search expresses "choosing the payment" as
// VARIANTS OF THE SAME cast/activate move, never as a search node (ADR 0091
// decision 4: a park lives inside the announcement window, where the opponent
// never acts, so a ply there buys tree depth for no information).
//
// K is HOW MANY variants the enumerator emits per park kind, per KIND (not per
// card). This table owns the CAST side only — the six `cast:*` parks — because
// that is what this issue ships (`gre/castCostPicks.ts`). Every one is K=1: the
// pick is fungible, so the deterministic cheapest-first victim is carried on the
// move and never multiplied into a variant axis. K=1 everywhere was considered
// and rejected in general (ADR 0091, alternatives — the variant machinery would
// be written and never traversed), but the ONE kind whose pick is a real
// decision is the ACTIVATION discard (Survival of the Fittest, designed K=3),
// which this table deliberately does not own — see the delimitation below.
//
// Bounds this table does NOT own, and why:
//
//  - **The ACTIVATION-side victim enumeration (`gre/activationCostPicks.ts`,
//    issue #2297).** `MAX_VICTIM_VARIANTS` (4) caps both the discard and the
//    single-victim sacrifice legs of an activated ability, chosen before this
//    table existed and pinned by #2297's own tests (Goblin Chirurgeon /
//    Fallen Angel victim choice). ADR 0091's DESIGNED K for those legs is 3
//    (discard — the pick IS the card) and 1 (sacrifice — lowest-mana-value
//    victim); the shared 4 is a superset of the discard design and a superset
//    of the sacrifice design, and reconciling either leg down to its designed
//    K is #2297's change, not this issue's. This table records the CAST side
//    and explicitly delimits the activation side rather than restating its
//    bound — a second parallel table is a review finding, not an
//    implementation (issue #2135 triage).
//
//  - **`MAX_KICKER_COMBINATIONS` / `MULTIKICKER_REPEAT_SAMPLES` (`gre/kicker.ts`,
//    issue #2081).** A Kicker is an OPTIONAL additional cost, not a mandatory
//    park: there is no `pendingCast`/`pendingActivation` picker awaiting it, the
//    caster simply pays it (or not) at announcement. Its bound lives in
//    `kicker.ts` beside `enumerateKickerVariants` because the constraint it
//    respects (the cast's ONE permanent-cost selection slot, CR 601.2f) is a
//    kicker-shaped concern; the two tables are different axes of the SAME
//    `announceVariants` cross-product (`moves.ts`), and this comment is the
//    delimit between them.
//
//  - **The CASTER-CHOSEN `oneOf` additional-cost disjunction is not a park at
//    all.** `additionalCostLegId` (CR 601.2b — Bitter Triumph's "discard a card
//    or pay 3 life") is classified `non-park` in the census (`owedPayment.ts`):
//    it is locked in at announcement, before the payment window opens. It is
//    already enumerated at FULL breadth by `moves.ts`'s `legVariants` via
//    `payableAdditionalCostLegs` (`gre/additionalCost.ts`) and charged by
//    `applyAdditionalCostLegForSearch` — a separate axis of the cross-product,
//    and this table does not regress it (issue #2135 triage, premise correction
//    2). It is distinct from the `cast:additionalCost` PARK (the EXILE
//    additional cost, Soul Exchange), which IS in this table at K=1.

import type { ParkKind } from "./owedPayment";

/** The CAST-side park kinds — the six parks a cast announcement can raise. */
export type CastParkKind = Extract<ParkKind, `cast:${string}`>;

/** K per CAST-side park kind — how many variants the enumerator emits. `1` =
 *  the deterministic pick only (no variant multiplication). `gre/castCostPicks.ts`
 *  is the implementation: `planCastCostPicks` returns the single deterministic
 *  plan, never a list, which is what "K=1" means structurally. A
 *  `Record<CastParkKind, number>` is a compile-time guard: a new `cast:*` park
 *  cannot compile until it is assigned a K here. */
export const PARK_VARIANT_K: Record<CastParkKind, number> = {
    "cast:sacrificeSelection": 1,
    "cast:additionalCost": 1,
    "cast:convokeCreatureChoice": 1,
    "cast:exileFromGraveyardChoice": 1,
    "cast:alternativeCostHandChoice": 1,
    "cast:manaSpendChoice": 1,
};
