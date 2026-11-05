// Undaunted (CR 702.125) — a static ability expanded implicitly from the
// `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the ADR 0054 mechanism. A card declares only
// `staticAbilities: ["undaunted"]`; `expandUndaunted` injects the
// `selfCostReduction` that enforces it.
//
// CR 702.125a: "Undaunted is a static ability that functions while the spell
// with undaunted is on the stack. Undaunted means 'This spell costs {1} less to
// cast for each opponent you have.'"
// CR 702.125b: "Players who have left the game are not counted when determining
// how many opponents you have."
// CR 702.125c: "If a spell has multiple instances of undaunted, each of them
// applies."
//
// The spell is not a permanent when it is announced, so it is the self-host
// reduction affinity uses (`getCostModifiers`, `gre/state.ts`), which also gives
// it the caster's seat (CR 601.2a) and a generic-only amount floored at {0}
// (CR 601.2f). The count is `censusOf`'s, which owns CR 702.125b.
//
// A GRANTED undaunted is not covered: this is a definition-level expander, so
// `isDefinitionLevelKeyword` (`oracle/lowerStatic.ts`) keeps a card that grants
// it in quarantine as `ungrantable-keyword`.

import type { CardDefinition, CostReductionAmount } from "../types";

const UNDAUNTED_KEYWORD = "undaunted";

function isOpponentCensus(amount: CostReductionAmount): boolean {
    return "countMode" in amount && amount.countMode === "opponents";
}

/** ADR 0054 keyword expansion — one {1} per opponent for each declared instance
 *  of undaunted (CR 702.125c counts every matching string, not the first). A
 *  no-op for every other card. */
export function expandUndaunted(def: CardDefinition): CardDefinition {
    const instances = (def.staticAbilities ?? []).filter(
        (s) => s.trim().toLowerCase() === UNDAUNTED_KEYWORD
    ).length;
    if (instances === 0) return def;
    const existing = def.selfCostReduction;
    // Idempotence guard: a definition already carrying the synthesized
    // reduction must not be expanded again.
    if (existing && isOpponentCensus(existing.costReduction)) return def;
    // `selfCostReduction` holds one reduction, so overwriting a card's own
    // would silently drop one of its two printed discounts.
    if (existing) {
        throw new Error(
            `${def.name}: undaunted cannot combine with an authored selfCostReduction`
        );
    }
    return {
        ...def,
        selfCostReduction: {
            costReduction: {
                perCount: { X: instances },
                countMode: "opponents",
            },
        },
    };
}
