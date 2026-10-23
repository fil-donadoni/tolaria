// Cost labels for the upkeep-cost keywords (Echo CR 702.30, Cumulative upkeep
// CR 702.24), DERIVED from the structured `MayPayCost` (ADR 0155) — a card
// declares only the cost, never a label beside it.
//
// The label is display text: the may-pay prompt, the stack reminder and the
// aggregated Oracle text read it; no rule does. The shapes are the printed
// ones: "{1}{U}" (mana), "Pay 2 life", "{B} and 1 life", "Sacrifice a land".

import type { CostLegs, ManaCost, MayPayCost } from "../types";

const COLOURED_PIPS = ["W", "U", "B", "R", "G", "C"] as const;

/** `{3}{U}{U}` — generic first, then coloured pips. A numeric `X` is the
 *  generic amount the Oracle mana reader writes (`lower.ts`), exactly as a
 *  hand-written `generic` is; an `xFactor` is never a printed upkeep cost. */
function manaLabel(mana: ManaCost): string {
    const generic =
        (mana.generic ?? 0) + (typeof mana.X === "number" ? mana.X : 0);
    let out = generic > 0 ? `{${generic}}` : "";
    for (const colour of COLOURED_PIPS) {
        out += `{${colour}}`.repeat(mana[colour] ?? 0);
    }
    return out || "{0}";
}

function isLegs(cost: MayPayCost): cost is CostLegs {
    return (
        "mana" in cost ||
        "life" in cost ||
        "permanent" in cost ||
        "hand" in cost ||
        "energy" in cost ||
        "graveyard" in cost
    );
}

/** "a land", "a creature", "a permanent" — the sacrificed object noun. */
function permanentNoun(permanent: NonNullable<CostLegs["permanent"]>): string {
    const types = (permanent.filter as { types?: unknown }).types;
    const word = typeof types === "string" ? types.toLowerCase() : "permanent";
    const count = permanent.count;
    if (typeof count === "object") {
        return `creatures with total power ${count.minTotalPower} or more`;
    }
    return count === 1 ? `a ${word}` : `${count} ${word}s`;
}

/** True when the cost is mana alone — the shape printed WITHOUT an em dash
 *  ("Echo {R}", "Cumulative upkeep {1}"). */
export function isManaOnlyUpkeepCost(cost: MayPayCost): boolean {
    if (!isLegs(cost)) return true;
    return (
        cost.mana !== undefined &&
        cost.life === undefined &&
        cost.permanent === undefined &&
        cost.hand === undefined &&
        cost.energy === undefined &&
        cost.graveyard === undefined
    );
}

/** The label of an upkeep cost, as the prompt prints it after the keyword. */
export function upkeepCostLabel(cost: MayPayCost): string {
    if (!isLegs(cost)) return manaLabel(cost);
    const parts: string[] = [];
    if (cost.mana) parts.push(manaLabel(cost.mana));
    if (cost.life !== undefined) parts.push(`${cost.life} life`);
    if (cost.permanent) {
        const verb =
            cost.permanent.action === "return" ? "return" : "sacrifice";
        parts.push(`${verb} ${permanentNoun(cost.permanent)}`);
    }
    if (cost.hand) {
        const n = cost.hand.requirements.reduce((sum, r) => sum + r.count, 0);
        parts.push(`${cost.hand.action} ${n === 1 ? "a card" : `${n} cards`}`);
    }
    if (cost.energy !== undefined) parts.push("{E}".repeat(cost.energy));
    if (cost.graveyard) {
        const n = cost.graveyard.count;
        parts.push(
            `return ${n === 1 ? "a card" : `${n} cards`} from your graveyard to your hand`
        );
    }
    const joined = parts.join(" and ");
    // A mana-only cost reads as its pips; a cost with an action reads as a
    // sentence — "Pay 2 life", "Sacrifice a land", "Pay {B} and 1 life".
    if (isManaOnlyUpkeepCost(cost)) return joined;
    if (!cost.permanent && !cost.hand && !cost.graveyard)
        return `Pay ${joined}`;
    return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The printed keyword line: "Echo {R}", "Cumulative upkeep—Pay 2 life". */
export function upkeepKeywordLine(keyword: string, cost: MayPayCost): string {
    const label = upkeepCostLabel(cost);
    return isManaOnlyUpkeepCost(cost)
        ? `${keyword} ${label}`
        : `${keyword}—${label}`;
}
