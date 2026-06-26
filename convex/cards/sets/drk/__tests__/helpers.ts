// Shared test helpers for the DRK per-colour test files (ADR 0043 split).
// Stack-push / resolve shims reused across the colour modules' describe
// blocks. Fixture builders (makeInstance/makePlayer/makeState/pushSpell) stay
// in convex/cards/__tests__/setup.ts.

import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getCardByName } from "../../../index";

/** Push a triggered ability onto the stack with the firing event, then resolve. */
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

export const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
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

/** Answer the head pending choice by injecting picks, then resolve again. */
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

export const FOREST = getCardByName("Forest").id;
export const ISLAND = getCardByName("Island").id;
export const PLAINS = getCardByName("Plains").id;
export const MOUNTAIN = getCardByName("Mountain").id;
export const SWAMP = getCardByName("Swamp").id;
