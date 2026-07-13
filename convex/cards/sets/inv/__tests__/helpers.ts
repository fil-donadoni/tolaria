// Shared test helpers for the INV per-colour test files (ADR 0043 split).
// Stack-push / resolve shims reused across the colour modules' describe
// blocks. Fixture builders (makeInstance/makePlayer/makeState/pushSpell) stay
// in convex/cards/__tests__/setup.ts.

import {
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

export function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

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

/** Answers the head `pendingChoices` entry (a `choice` Op suspension, e.g.
 *  `choose-hand-card`) with the given card instance ids (CR 608.2). */
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
