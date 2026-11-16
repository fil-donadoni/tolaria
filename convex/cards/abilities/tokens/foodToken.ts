// The Food token (CR 111.10b) — sugar for the "create a Food token" clause
// (issue #778). The token itself is the ONE shared spec, `FOOD_TOKEN`
// (`sharedTokens.ts`): a colorless Food artifact token with "{2}, {T},
// Sacrifice this token: You gain 3 life." This module once carried a second
// Food spec of its own with a different ability id and text, so two producers
// created two different Food tokens; issue #9948 folded it onto the shared one,
// the row `PREDEFINED_TOKEN_SPECS` names for "Food".

import type { EffectOp, EffectPlayerRef, EffectValue } from "../../types";
import { FOOD_TOKEN } from "../../sharedTokens";

/** Sugar for "create a Food token" as an Effect Script Op: create one Food
 *  token (`FOOD_TOKEN`) for `controller` (default the resolving controller,
 *  CR 111.2). `count` allows "create N Food tokens" the same way
 *  `investigateOp` allows Investigate N. */
export function createFoodTokenOp(
    controller: EffectPlayerRef = "controller",
    count?: EffectValue
): EffectOp {
    return {
        op: "createToken",
        token: FOOD_TOKEN,
        controller,
        ...(count !== undefined ? { count } : {}),
    };
}
