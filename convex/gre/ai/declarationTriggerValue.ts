// What does a declaration's trigger batch buy the attacking player? — the
// off-combat half of "did this attack gain anything?".
//
// `isWastefulAttack` (search.ts) reads the combat prediction alone: a dead
// blocker, face damage, planeswalker loyalty. An attack whose payoff is a
// trigger the declaration itself put on the stack ("whenever a creature you
// control becomes tapped", "whenever ~ attacks") gains nothing by that
// reading, however much it produces. This module prices the batch with the
// existing Effect Script valuation (`valueEffectScript`, i.e. `OP_VALUERS`) —
// no card names, no per-card list (ADR 0102).
//
// SIGN. A trigger's script is valued from its CONTROLLER's seat. The
// attacker's own triggers add their points; the defender's (a punisher on
// attack / tap) are subtracted, so a hostile trigger can never make an attack
// look productive. An unreadable script (no `effects`, no `aiEffects` shadow)
// is worth nothing — fail open to neutral, never to positive.

import type { EffectOp } from "../../cards/types";
import type { GameState, StackItem } from "../state";
import { findTriggeredAbility } from "../copy";
import { contextFreeGrounding } from "./grounding";
import { valueEffectScript } from "./opValuers";

/** The script a triggered stack item will run: its announced mode's for a
 *  modal trigger (CR 700.2c), else its real `effects[]`, else the `aiEffects`
 *  shadow. `undefined` when none is readable. */
function triggerScript(item: StackItem): readonly EffectOp[] | undefined {
    if (!item.triggeredAbilityId) return undefined;
    const ability = findTriggeredAbility(item, item.triggeredAbilityId);
    if (!ability) return undefined;
    if (ability.modes && ability.modes.length > 0) {
        const modeId = item.chosenModeIds?.[0];
        const mode = ability.modes.find((m) => m.id === modeId);
        return mode?.effects;
    }
    return ability.effects ?? ability.aiEffects;
}

/** Net worth to `attackerId` of the triggers on `state.stack` whose ids are not
 *  in `before` — the batch a declaration just placed — plus the batch held off
 *  the stack while a CR 603.3b ordering choice is open (two distinct triggers
 *  of one controller, e.g. an attack trigger beside a tap payoff). Positive
 *  only when the attacker's side nets a gain; 0 for an empty batch. */
export function declarationTriggerNetValue(
    state: GameState,
    attackerId: string,
    before: ReadonlySet<string>
): number {
    let net = 0;
    for (const item of [...state.stack, ...(state.pendingTriggerBatch ?? [])]) {
        if (before.has(item.id) || !item.triggeredAbilityId) continue;
        const script = triggerScript(item);
        if (!script) continue;
        const points = valueEffectScript(script, contextFreeGrounding()).points;
        net += item.castById === attackerId ? points : -points;
    }
    return net;
}
