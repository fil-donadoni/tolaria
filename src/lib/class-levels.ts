import { getDefinition } from "@convex/cards";
import {
    CLASS_SUBTYPE,
    classLevelOf,
} from "@convex/cards/abilities/classLevels";
import type { ManaCost } from "@convex/cards/types";
import type { CardInstance } from "~/types/game";

/** What the board has to show for a Class permanent (CR 716): the level it is
 *  at now, and — while there is one left — the next level and the cost printed
 *  on its bar. Without the second half the affordance is invisible: CR 716.2a
 *  admits exactly ONE bar at any moment (the one for level+1), so a player who
 *  cannot see which that is, and what it costs, cannot tell the Class is doing
 *  anything at all. */
export interface ClassLevelDisplay {
    /** The Class's current level (CR 716.2d — 1 when it has none). */
    level: number;
    /** The next level, or `null` when the Class is at its highest bar. */
    nextLevel: number | null;
    /** The mana symbols printed on the next bar, in the order they are shown
     *  (generic first, then WUBRG, then colorless — CR 202.1). Empty when
     *  `nextLevel` is null. */
    nextCostSymbols: string[];
}

/** Canonical pip order for a printed cost (CR 202.1): the generic pip first,
 *  then the five colours in WUBRG order, then colorless. */
const COLOR_PIPS = ["W", "U", "B", "R", "G"] as const;

/** Flattens a `ManaCost` into the symbol strings `ManaSymbol` renders. Variable
 *  `{X}` is carried through as the literal `X` pip; no class level bar prints
 *  one today, but dropping it silently would understate a future bar's cost. */
function costSymbols(cost: ManaCost): string[] {
    const symbols: string[] = [];
    if (cost.X === "X") {
        for (let i = 0; i < (cost.xFactor ?? 1); i++) symbols.push("X");
    } else if (typeof cost.X === "number" && cost.X > 0) {
        symbols.push(String(cost.X));
    }
    if (cost.generic !== undefined && cost.generic > 0) {
        symbols.push(String(cost.generic));
    }
    for (const pip of COLOR_PIPS) {
        for (let i = 0; i < (cost[pip] ?? 0); i++) symbols.push(pip);
    }
    for (let i = 0; i < (cost.C ?? 0); i++) symbols.push("C");
    return symbols;
}

/** CR 716 — the Class level line for a battlefield permanent, or `null` when
 *  the permanent is not a Class.
 *
 *  Keyed on the SUBTYPE, not on the presence of a level: CR 716.2d says a Class
 *  that has never been levelled IS level 1, and that is exactly the state whose
 *  affordance most needs showing. It reads the definition's own
 *  `classLevelBars[]` — the printed bars, which survive `expandClassLevelBars`
 *  untouched — so the cost shown is the one on the card rather than a
 *  re-derivation of the expanded ability's cost. */
export function getClassLevelDisplay(
    card: CardInstance
): ClassLevelDisplay | null {
    if (!card.subtypes?.includes(CLASS_SUBTYPE)) return null;
    const bars = getDefinition(card.card.id).classLevelBars;
    if (!bars || bars.length === 0) return null;
    const level = classLevelOf(card);
    const next = bars.find((bar) => bar.level === level + 1);
    return {
        level,
        nextLevel: next?.level ?? null,
        nextCostSymbols: next ? costSymbols(next.cost) : [],
    };
}
