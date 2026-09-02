/**
 * Lowering: activated-ability IR → `ActivatedAbility` (CR 602.1a, ADR 0045).
 *
 * What is left here is only what is ACTIVATED-specific: the cost, the CR 602.5
 * restriction sentences, and the assembly of the two into an ability. The
 * sentence lowering and the target-slot bookkeeping moved to `lowerEffects.ts`
 * when the triggered slot (#2698) became their second consumer — see that
 * file's header for why one walk has to own the target indexes.
 */

import type { ActivatedAbility, EffectOp } from "../cards/types";
import {
    lowerActivationCost,
    type ActivationCostIR,
} from "./grammar/shared/cost";
import type {
    EffectSentenceIR,
    RestrictionIR,
} from "./grammar/shared/effectClause";
import { declareTargets, lowerSentence, TargetSlots } from "./lowerEffects";

/** Re-exported: `compile.test.ts` reaches for it here, and the >1-target
 *  refusal it guards is stated in this file's contract (one target per
 *  activated ability) as much as in the shared module's. */
export { declareTargets } from "./lowerEffects";

export type LowerAbilityResult =
    | { readonly ok: true; readonly ability: ActivatedAbility }
    | { readonly ok: false; readonly reason: string };

/** CR 602.5 — restriction sentences onto the ability's own fields. */
function applyRestrictions(
    ability: ActivatedAbility,
    restrictions: readonly RestrictionIR[]
): string | null {
    for (const restriction of restrictions) {
        switch (restriction.kind) {
            case "sorcery-only":
                ability.sorcerySpeedOnly = true;
                break;
            case "once-per-turn":
                ability.oncePerTurn = true;
                break;
            case "your-turn-only":
                ability.controllerTurnOnly = true;
                break;
            case "phase":
                // "only during your upkeep" is two restrictions in one
                // sentence: the STEP and whose turn it is (CR 500.2 — every
                // turn has an upkeep, including the opponent's).
                ability.activationPhaseRestriction = [restriction.phase];
                ability.controllerTurnOnly = true;
                break;
            case "any-player":
                ability.activatableByAnyPlayer = true;
                break;
            default: {
                const never: never = restriction;
                return `no lowering for restriction ${JSON.stringify(never)}`;
            }
        }
    }
    return null;
}

export function lowerActivatedAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    readonly cost: ActivationCostIR;
    readonly effects: readonly EffectSentenceIR[];
    readonly restrictions: readonly RestrictionIR[];
}): LowerAbilityResult {
    const cost = lowerActivationCost(input.cost);
    if (!cost.ok) return { ok: false, reason: cost.reason };

    const slots = new TargetSlots();
    const ops: EffectOp[] = [];
    for (const sentence of input.effects) {
        // CR 107.3 — an activated ability announces X in its ACTIVATION cost,
        // which the cost sub-grammar does not yet read as a variable, so no
        // site here can supply a value for it.
        const result = lowerSentence(sentence, slots, {
            allowX: false,
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        ops.push(...result.value);
    }

    const ability: ActivatedAbility = {
        id: input.id,
        oracleText: input.oracleText,
        cost: cost.value,
        // CR 602.1a / 605.3a — an activated ability that is not a mana ability
        // uses the stack. The mana slot is the only site that emits `false`.
        useStack: true,
        effects: ops,
    };
    const targetError = declareTargets(ability, slots.requirements());
    if (targetError !== null) return { ok: false, reason: targetError };

    const restrictionError = applyRestrictions(ability, input.restrictions);
    if (restrictionError !== null)
        return { ok: false, reason: restrictionError };
    return { ok: true, ability };
}
