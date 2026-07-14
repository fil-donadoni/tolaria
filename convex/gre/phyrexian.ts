// Phyrexian mana ({C/P}) — cost-system infrastructure, NOT an Effect Script Op
// and NOT a Mechanics Registry keyword row. CR 107.4f: "A Phyrexian mana symbol
// can be paid with either the indicated color of mana or 2 life." A card's
// printed cost declares its Phyrexian pips in `ManaCost.phyrexian`
// (`{ B: 2 }` for Dismember `{1}{B/P}{B/P}`); the mana-vs-life split for each
// pip is a per-pip choice the caster makes at cast time (CR 601.2f/601.2h — pay
// costs). This module holds the PURE representation helpers; the affordability
// solver (`solvePhyrexianSplit`) lives in `rules.ts` because it reuses the
// mana-affordability model there, and the payment is threaded through
// `announceCast` (`phyrexianLifePips`) in `game.ts`.
//
// Life cost per Phyrexian pip (CR 107.4f).
import type { Color, ManaCost } from "../cards/types";
import { MANA_COLORS } from "./constants";

/** Life paid per Phyrexian pip chosen to be paid with life (CR 107.4f). */
export const PHYREXIAN_LIFE_PER_PIP = 2;

/** Total number of Phyrexian pips in a cost (Dismember → 2, Gitaxian Probe →
 *  1). Zero when the cost has no Phyrexian pips (the overwhelmingly common
 *  case), so every caller can cheaply branch on `> 0`. */
export function phyrexianPipCount(cost?: ManaCost): number {
    if (!cost?.phyrexian) return 0;
    let total = 0;
    for (const n of Object.values(cost.phyrexian)) {
        if (typeof n === "number" && n > 0) total += n;
    }
    return total;
}

/** The Phyrexian pips expanded into a per-pip colour list in canonical WUBRG
 *  order (Dismember → `["B", "B"]`). Used to enumerate mana-vs-life splits pip
 *  by pip. Empty for a cost with no Phyrexian pips. */
export function phyrexianPipColors(cost?: ManaCost): Color[] {
    if (!cost?.phyrexian) return [];
    const out: Color[] = [];
    for (const c of MANA_COLORS) {
        const n = cost.phyrexian[c] ?? 0;
        for (let i = 0; i < n; i++) out.push(c);
    }
    return out;
}

/** Given how many Phyrexian pips are paid with LIFE (assigned to the FIRST
 *  `lifePips` pips in canonical WUBRG order), return the per-colour mana that
 *  the REMAINING pips must supply — i.e. the colours to fold into the spell's
 *  fixed mana cost. `lifePips` is clamped to `[0, total]`. Dismember paying 1
 *  pip with life → `{ B: 1 }` extra mana; paying both with life → `{}`. */
export function phyrexianManaAdditions(
    cost: ManaCost | undefined,
    lifePips: number
): Partial<Record<Color, number>> {
    const pips = phyrexianPipColors(cost);
    const clamped = Math.max(0, Math.min(lifePips, pips.length));
    const additions: Partial<Record<Color, number>> = {};
    // The first `clamped` pips are paid with life; the rest with mana.
    for (let i = clamped; i < pips.length; i++) {
        const c = pips[i];
        additions[c] = (additions[c] ?? 0) + 1;
    }
    return additions;
}
