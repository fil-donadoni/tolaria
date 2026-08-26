// Shared test helpers for the ARN per-colour test files (ADR 0043 split).
// Stack-push / resolve shims and synthetic trigger events reused across the
// colour modules' describe blocks. Fixture builders (makeInstance/makePlayer/
// makeState/pushSpell) stay in convex/cards/__tests__/setup.ts.

import {
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import type { PhaseBeginEvent } from "../../../types";

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

/** Puts a triggered ability on the stack the way `buildTriggerItem` does (a
 *  `...self` spread plus the trigger legs) WITHOUT resolving it, so a test can
 *  interpose something — a blink in response — between the trigger and its
 *  CR 603.4 resolution-time re-check. Returns the pushed item. */
export function pushTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): StackItem {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    };
    state.stack.push(item);
    return item;
}

export function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    pushTrigger(state, source, triggeredAbilityId, triggerEvent, targets);
    resolveTopOfStack(state);
}

export function answerChoice(state: GameState, picks: string[]): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

export const upkeepEvent = (playerId: string) =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

export const endStepEvent = (playerId: string): PhaseBeginEvent => ({
    type: "PHASE_BEGIN",
    phase: "END_STEP",
    activePlayerId: playerId,
});

export function resolveDelayed(
    state: GameState,
    sourceCardId: string,
    controller: string,
    delayedTriggerId: string,
    payload: Record<string, string>
): void {
    state.stack.push({
        id: `dt-stack-${delayedTriggerId}`,
        card: { id: sourceCardId },
        controllerId: controller,
        ownerId: controller,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: controller,
        delayedTriggerId,
        delayedPayload: payload,
    } as StackItem);
    resolveTopOfStack(state);
}

export const WIN_SEED = 1;

export const LOSE_SEED = 7;
