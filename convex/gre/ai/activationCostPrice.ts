// Issue #9592 — the latent price of an activated ability's COST, for the
// option reading of a self-consuming ability (`dslSelfConsumingOption`,
// `ai/cardScriptValue.ts`): what the holder gives up, beside the permanent
// itself, to buy the effect. Pure, no state.

import type { ActivatedAbility } from "../../cards/types";
import { manaValue } from "../constants";
import type { LatentWeights } from "./evalWeights";

/** The share of the `ramp` unit (one mana produced) one mana of activation
 *  cost is priced at. Half: an option is exercised when its holder chooses,
 *  out of mana that would otherwise sit idle that turn, so the mana is worth
 *  less than mana a ramp spell adds to a turn that wants it — the same
 *  half-price argument `costTaxWeight` makes for a one-off tax against a
 *  renewable source (`ai/evalWeights.ts`). */
export const ACTIVATION_MANA_SHARE = 0.5;

/** The cost components this reader prices. The permanent itself
 *  (`sacrifice`, `exileThis`) is what the option reading is about, so it is
 *  free here; tapping it is free too (it leaves the battlefield anyway).
 *  Anything else a cost can ask for — another permanent, a counter, a card in
 *  a graveyard, a return to hand — has no latent unit this reader can charge,
 *  so a cost carrying it is UNPRICED and the ability reads no option
 *  (fail-closed: such a permanent keeps the floor it had before #9592). */
const PRICED_COST_KEYS: ReadonlySet<string> = new Set([
    "tap",
    "mana",
    "sacrifice",
    "exileThis",
    "life",
    "discardFilter",
    "discardAtRandom",
]);

/** The latent price of `cost` beside the permanent it consumes: mana at
 *  `ACTIVATION_MANA_SHARE` of `ramp` per mana of its mana value (CR 202.3 —
 *  a variable `{X}` counts 0, the cheapest activation), life at `lifeSwing`
 *  per point (CR 119.4), a discarded card at `cardAdvantage` (CR 701.9).
 *  `undefined` when the cost carries a component this reader cannot price. */
export function activationCostPrice(
    cost: ActivatedAbility["cost"],
    weights: LatentWeights
): number | undefined {
    for (const [key, value] of Object.entries(cost)) {
        if (value === undefined || value === false) continue;
        if (!PRICED_COST_KEYS.has(key)) return undefined;
    }
    const mana = cost.mana ? manaValue(cost.mana) : 0;
    const discards =
        (cost.discardFilter?.count ?? 0) + (cost.discardAtRandom ?? 0);
    return (
        mana * weights.ramp * ACTIVATION_MANA_SHARE +
        (cost.life ?? 0) * weights.lifeSwing +
        discards * weights.cardAdvantage
    );
}
