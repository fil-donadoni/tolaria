// Shared test shims for the AFR per-colour test files (ADR 0043 split).
// Stack-push/resolve + pending-choice shim. Fixture builders
// (makeInstance/makePlayer/makeState) stay in convex/cards/__tests__/setup.ts.
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";

/** Push a triggered ability onto the stack with the given trigger event, then
 *  resolve it (mirrors the engine after a trigger is put on the stack). */
export function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** Answer the head pending resolution choice with the given instance ids
 *  (resumes a suspended `requestChoice`). */
export function submitChoice(
    state: GameState,
    cardInstanceIds: string[]
): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}
