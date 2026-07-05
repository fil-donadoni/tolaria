// Shared test helpers for the LEA per-colour test files (ADR 0043 split).
// Stack-push / resolve shims and synthetic fixtures reused across the colour
// modules' describe blocks. Fixture builders (makeInstance/makePlayer/makeState/
// pushSpell) stay in convex/cards/__tests__/setup.ts.

import { expect } from "vitest";
import { grizzlyBears, serraAngel } from "..";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { advancePhase } from "../../../../gre/phases";

export function activatePump(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Drives the incoming player's UNTAP step by advancing from END_STEP:
 *  CLEANUP auto-resolves, turn flips, UNTAP auto-resolves, state settles
 *  in UPKEEP of the intended player. Shared by all gap-J describe blocks. */
export function runUntapForJ(playerId: string, state: GameState): void {
    state.activePlayerId = playerId === "p1" ? "p2" : "p1";
    state.phase = "END_STEP";
    advancePhase(state);
}

export function grizzlyBearsId(): string {
    // grizzlyBears is exported from lea.ts — use getCardByName to stay
    // decoupled if we rename the variable.
    return "ce2d603a-3231-4a8c-bf39-1617586ea870";
}

/** Push a delayed trigger instance onto the stack for resolution. */
export function pushDelayedTrigger(
    state: GameState,
    dt: {
        sourceCardId: string;
        controller: string;
        triggerId: string;
        // A value is a single id (ADR 0048) or a frozen `string[]` list
        // (ADR 0049, issue #866 — a list-valued capture).
        payload: Record<string, string | string[]>;
    },
    id = "delayed-1"
): void {
    state.stack.push({
        id,
        card: { id: dt.sourceCardId },
        controllerId: dt.controller,
        ownerId: dt.controller,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: dt.controller,
        delayedTriggerId: dt.triggerId,
        delayedPayload: dt.payload,
    });
}

export const SERRA = serraAngel.id;

export const BEARS = grizzlyBears.id;

/** Drives a suspended resolve-step copy choice (may-pay → choose-permanents)
 *  by writing collectedChoices directly, mirroring the engine's resume path.
 *  `recipientItem` is the stack item carrying the resolve. */
export function driveCopyChoice(
    state: GameState,
    recipientItem: StackItem,
    targetInstanceId: string
): void {
    // step: optional "may have it become a copy"
    expect(resolveTopOfStack(state)).toBeNull();
    let head = state.pendingChoices![0];
    expect(head.kind).toBe("may-pay");
    recipientItem.collectedChoices = {
        ...(recipientItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: ["yes"],
    };
    state.pendingChoices = undefined;
    // step: choose the creature/artifact to copy
    expect(resolveTopOfStack(state)).toBeNull();
    head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-permanents");
    expect(head.allControllers).toBe(true);
    recipientItem.collectedChoices = {
        ...(recipientItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [targetInstanceId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}
