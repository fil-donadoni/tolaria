/**
 * CR 601.2f — the pricings the Bot's cast enumerator plans a tap payment
 * under, when the spell's own self reduction is conditional on its targets
 * ("This spell costs {2} less to cast if it targets a blue spell").
 *
 * The enumerator prices a cast BEFORE it picks targets (CR 601.2c precedes
 * 601.2f only at the real commit; the move list needs a tap plan per target
 * tuple), so a target-conditional reduction has two possible totals. Priced
 * once, without targets, the reduction is granted whenever ANY matching spell
 * is on the stack — and then neither answer alone is right: the reduced plan
 * is short for a target that does not earn the reduction, and a plan priced
 * without the reduction (no matching spell anywhere) used to be filtered as if
 * it had been reduced, so the cast was never offered at all (issue #10514).
 *
 * Each pricing names the answer its plan was priced for; the enumerator keeps
 * only the target tuples that give the same answer, so every tuple is offered
 * at exactly the total the commit charges for it.
 */

import type { CardDefinition, SpellFilter } from "../cards/types";
import type { CostModifiers } from "./state/declarations";
import {
    getCostModifiers,
    targetsMatchingSpellExist,
    type CardInstanceState,
    type GameState,
} from "./state";

export interface CostPricing {
    /** The modifiers the tap plan folds in; `undefined` = none (the
     *  Phyrexian carve-out). */
    readonly modifiers: CostModifiers | undefined;
    /** Set when this pricing assumed an answer to the reduction's target
     *  condition: only a target tuple giving the same answer may ride it. */
    readonly earnsReduction?: {
        readonly filter: SpellFilter;
        readonly earned: boolean;
    };
}

export function targetConditionalCostPricings(
    state: GameState,
    card: CardInstanceState,
    announcerId: string,
    def: CardDefinition | null | undefined,
    costModifiers: CostModifiers | undefined
): readonly CostPricing[] {
    const filter = def?.selfCostReduction?.ifTargetsSpell;
    if (filter === undefined || costModifiers === undefined)
        return [{ modifiers: costModifiers }];
    // Priced without targets, the reduction is granted iff a matching spell
    // is on the stack at all (`targetsMatchingSpellExist` with no announced
    // targets). Not granted: every tuple pays the full cost, and that is the
    // plan the modifiers already price.
    if (!targetsMatchingSpellExist(state, filter, undefined))
        return [
            {
                modifiers: costModifiers,
                earnsReduction: { filter, earned: false },
            },
        ];
    // Granted: the reduced plan for the tuples that earn it, and the full
    // plan — the modifiers recomputed against an announcement naming no
    // matching spell — for the ones that do not. Reduced first, so the
    // combination cap truncates the dearer line.
    return [
        { modifiers: costModifiers, earnsReduction: { filter, earned: true } },
        {
            modifiers: getCostModifiers(
                state,
                card,
                "spell",
                undefined,
                announcerId,
                []
            ),
            earnsReduction: { filter, earned: false },
        },
    ];
}
