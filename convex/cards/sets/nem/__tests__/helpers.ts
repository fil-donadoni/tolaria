// Shared test helpers for the NEM per-colour test files (ADR 0043 split).
// Stack-push / resolve shims reused across the colour modules' describe
// blocks. Fixture builders (makeInstance/makePlayer/makeState/pushSpell) stay
// in convex/cards/__tests__/setup.ts. Mirrors drk/__tests__/helpers.ts.

import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";

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

export const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** A PERMANENT_LEFT event for `sourceId` leaving the battlefield to the
 *  graveyard (CR 603.7a). The exile-return condition reads `state.exileHeld`,
 *  not these fields, so controller/types carry harmless defaults. */
export const LEFT = (
    sourceId: string,
    controllerId = "p1"
): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_LEFT" as const,
        instanceId: sourceId,
        controllerId,
        ownerId: controllerId,
        types: ["Enchantment"] as const,
        wasAura: false,
        toZone: "graveyard" as const,
    }) as StackItem["triggerEvent"];
