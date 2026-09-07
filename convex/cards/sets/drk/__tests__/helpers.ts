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
import { getDefinition } from "../../../index";

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

export const FOREST = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b").id;
export const ISLAND = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5").id;
export const PLAINS = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed").id;
export const MOUNTAIN = getDefinition(
    "eace2c85-976c-425e-9800-5a6ccbd91b56"
).id;
export const SWAMP = getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8").id;
