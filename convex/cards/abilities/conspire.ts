// Conspire — CR 702.78.
//
// CR 702.78a: the keyword is two abilities, an optional additional cost ("you
// may tap two untapped creatures you control that each share a color with it")
// and a cast trigger ("if its conspire cost was paid, copy it"). The trigger
// half is the engine's synthesized cast-copy trigger (ADR 0052), reached through
// the `conspire` row of `ADDITIONAL_COST_KEYWORDS` (`gre/kicker.ts`), so a card
// authors only this cost entry beside its `staticAbilities: ["conspire"]`.
//
// CR 702.78b is the per-id payment record's own shape: each instance is its own
// `kickers[]` entry, paid separately, and triggers on its own payment.
import type { KickerCost } from "../types";

/** The keyword as it appears in `staticAbilities`. */
export const CONSPIRE_KEYWORD = "conspire";

/** CR 702.78a — the cost half of one conspire instance. The colour half of
 *  "share a color with it" is not in `filter` because it is a fact about the
 *  spell as it is cast, not about the card: `sharesColorWithCastSpell` is bound
 *  to the spell's live colours when the cost is priced (`gre/kicker.ts`). */
export function conspireCost(): KickerCost {
    return {
        id: CONSPIRE_KEYWORD,
        keyword: "conspire",
        description:
            "Conspire — tap two untapped creatures you control that each share a color with this spell",
        permanent: {
            action: "tap",
            filter: { types: ["Creature"], tapped: false },
            count: 2,
            sharesColorWithCastSpell: true,
        },
    };
}
