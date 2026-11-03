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

/** CR 107.4f / 119.4 — the life-pip counts an activating player may choose for
 *  an activated ability's Phyrexian pips: every count from 0 up to the pips
 *  the player's life can cover at 2 life each. Mana affordability is NOT
 *  probed here — an activation's mana is paid in the payment phase that
 *  follows the announcement (CR 602.2b → 601.2g/601.2h), so a mana-paid pip
 *  is always a legal announcement. `[]` for a cost with no Phyrexian pip;
 *  a single entry (`[0]`, life below 2) is a degenerate choice. Pure: the
 *  client reads it as a prompt hint, the server re-validates the pick through
 *  {@link resolvePhyrexianActivationPayment}. */
export function phyrexianActivationLifePipOptions(
    cost: ManaCost | undefined,
    life: number
): number[] {
    const pips = phyrexianPipCount(cost);
    if (pips === 0) return [];
    const max = Math.max(
        0,
        Math.min(pips, Math.floor(life / PHYREXIAN_LIFE_PER_PIP))
    );
    return Array.from({ length: max + 1 }, (_, i) => i);
}

/** CR 107.4f / 602.2b / 601.2f — resolve the mana-vs-life split for an
 *  activated ability's Phyrexian pips at announcement. `chosenLifePips` is the
 *  activator's pick (how many pips are paid with 2 life each); absent → the
 *  most-life split the player's life covers, the same preference the cast
 *  path's solver takes. Throws on a pick outside
 *  {@link phyrexianActivationLifePipOptions} — CR 119.4: a player with less
 *  than 2 life cannot pay a pip with life. Returns the per-colour mana the
 *  remaining pips add to the cost and the life owed. A cost with no Phyrexian
 *  pip resolves to `{ lifePips: 0, manaAdditions: {}, payLife: 0 }`. */
export function resolvePhyrexianActivationPayment(
    cost: ManaCost | undefined,
    life: number,
    chosenLifePips?: number
): {
    lifePips: number;
    manaAdditions: Partial<Record<Color, number>>;
    payLife: number;
} {
    const options = phyrexianActivationLifePipOptions(cost, life);
    if (options.length === 0) {
        if (chosenLifePips !== undefined && chosenLifePips !== 0) {
            throw new Error("This ability has no Phyrexian mana to pay");
        }
        return { lifePips: 0, manaAdditions: {}, payLife: 0 };
    }
    const lifePips = chosenLifePips ?? options[options.length - 1];
    if (!options.includes(lifePips)) {
        throw new Error("Not enough life to pay that Phyrexian mana with life");
    }
    return {
        lifePips,
        manaAdditions: phyrexianManaAdditions(cost, lifePips),
        payLife: lifePips * PHYREXIAN_LIFE_PER_PIP,
    };
}

/** Fold a Phyrexian split's mana-paid pips into a normalized cost, in place —
 *  after any cost modifier ran, so a generic reduction never touches a pip. */
export function foldPhyrexianManaAdditions(
    manaCost: Record<string, number>,
    additions: Partial<Record<Color, number>>
): Record<string, number> {
    for (const [c, n] of Object.entries(additions)) {
        if (n && n > 0) manaCost[c] = (manaCost[c] ?? 0) + n;
    }
    return manaCost;
}

/** CR 107.4f — fail closed on a Phyrexian pip in a cost whose payment path has
 *  no mana-vs-life split (a mana ability, CR 605; a player-scoped granted
 *  ability). `normalizeManaCost` drops the `phyrexian` record, so without this
 *  the pip would be FREE there. No shipped card carries such a cost; one that
 *  does gets the split wired into that path, never a free pip. */
export function assertNoUnsplitPhyrexianPip(cost: ManaCost | undefined): void {
    if (phyrexianPipCount(cost) > 0) {
        throw new Error(
            "Phyrexian mana is not payable in this ability's cost path"
        );
    }
}
