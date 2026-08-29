// The per-kind K table for payment-park variant enumeration (ADR 0091 decision
// 4, issue #2135).
//
// A payment park (see `owedPayment.ts`) is a mandatory cost-payment decision
// suspended inside the announcement window: which permanent to sacrifice, which
// card to discard or exile. The search expresses "choosing the payment" as
// VARIANTS OF THE SAME cast/activate move, never as a search node (ADR 0091
// decision 4: a park lives inside the announcement window, where the opponent
// never acts, so a ply there buys tree depth for no information).
//
// K is HOW MANY variants the enumerator emits per park kind. It is per KIND,
// not per card, and it is small and deliberate:
//
// | park kind                                   | K | why |
// | ------------------------------------------- | - | --- |
// | `activation:discardFilterChoice`            | 3 | the pick IS the card — Survival of the Fittest is a tutor only if it chooses what to pitch |
// | `cast:sacrificeSelection` / `activation:sacrificeSelection` | 1 | lowest-mana-value victim is right nearly always |
// | `activation:tapOtherChoice`                 | 1 | crew — a covering set, identity barely matters |
// | `cast:exileFromGraveyardChoice` / `activation:exileFromGraveyardChoice` | 1 | Night Soil-shaped, fungible |
// | `cast:additionalCost`                       | 1 | the EXILE additional cost (Soul Exchange) — fungible victim |
// | `cast:convokeCreatureChoice` / `cast:alternativeCostHandChoice` / `cast:manaSpendChoice` / `activation:manaSpendChoice` | 1 | fungible / deterministic |
//
// K=1 everywhere was considered and rejected (ADR 0091, alternatives): the whole
// variant machinery would be written and never traversed with more than one
// branch — a dead path discovered broken exactly when #2081 raised K. The ONE
// kind whose pick is a real decision — Survival's discard — earns its K=3.
//
// Three bounds this table does NOT own, and why:
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
//  - **`MAX_VICTIM_VARIANTS` (`gre/activationCostPicks.ts`, issue #2297).** The
//    ACTIVATION-side victim enumeration predates this table and uses one shared
//    cap (4) for both the discard and the single-victim sacrifice leg. The K
//    table records the DESIGNED bound per kind (discard 3, sacrifice 1); the
//    implementation's shared 4 is a deliberate superset kept for #2297's
//    Goblin-Chirurgeon behaviour, and the activation enumerator is documented
//    as the implementation of the `activation:*` rows here rather than a
//    second table.
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

/** K per park kind — how many variants the enumerator emits. `1` = the
 *  deterministic pick only (no variant multiplication). The `activation:` rows
 *  are realised by `gre/activationCostPicks.ts` (bounded by
 *  `MAX_VICTIM_VARIANTS`, a documented superset); the `cast:` rows by
 *  `gre/castCostPicks.ts` (all K=1, the deterministic plan). */
export const PARK_VARIANT_K: Record<ParkKind, number> = {
    "cast:sacrificeSelection": 1,
    "cast:additionalCost": 1,
    "cast:convokeCreatureChoice": 1,
    "cast:exileFromGraveyardChoice": 1,
    "cast:alternativeCostHandChoice": 1,
    "cast:manaSpendChoice": 1,
    "activation:sacrificeSelection": 1,
    "activation:exileFromGraveyardChoice": 1,
    "activation:tapOtherChoice": 1,
    "activation:discardFilterChoice": 3,
    "activation:manaSpendChoice": 1,
};
