import type { ManaCost } from "../types";

/** Renders a `ManaCost` as its `{2}{G}{G}` reminder-text label (CR 107.1/202.1).
 *  Generic first (the codebase encodes fixed generic as a numeric `X`, see
 *  `ManaCost`), then one pip per coloured/colourless unit in WUBRG order so the
 *  label matches the printed cost's canonical ordering. */
export function keywordCostLabel(cost: ManaCost): string {
    const generic =
        (typeof cost.X === "number" ? cost.X : 0) + (cost.generic ?? 0);
    let out = generic > 0 ? `{${generic}}` : "";
    for (const sym of ["W", "U", "B", "R", "G", "C"] as const) {
        const n = cost[sym];
        if (typeof n === "number") out += `{${sym}}`.repeat(n);
    }
    return out;
}
