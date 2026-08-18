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
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

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

/** Answers whatever as-enters prompt is at the head of the queue through the
 *  real submit mutation (ADR 0100 D5 — stackless, `stackItemId: ""`). `[]` is
 *  the decline of an optional choice. */
export function driveCopyChoiceAnswer(
    state: GameState,
    cardInstanceIds: string[]
): void {
    const head = state.pendingChoices![0];
    expect(head.asEntersCardId).toBeDefined();
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** Drives the CAST leg of an as-enters `copy` choice (CR 614.12a / 707.5, ADR
 *  0100, issue #2451) through the REAL submit path: resolve the permanent
 *  spell, which parks the entry off every zone and raises one stackless
 *  `choose-permanents` prompt, then answer it with `applyPendingChoiceSubmit`.
 *
 *  Pre-#2451 this drove a `resolveSteps` may-pay → choose-permanents pair by
 *  writing `collectedChoices` directly; that protocol is gone — the choice is
 *  now a declaration on `entersWith.asEnters` and is raised on EVERY entry
 *  path, not only a cast.
 *
 *  `targetInstanceId` of `null` is the DECLINE (the printed "you may"): an
 *  empty submission, after which the permanent enters as its printed self. */
export function driveCopyChoice(
    state: GameState,
    recipientItem: StackItem,
    targetInstanceId: string | null
): void {
    // The spell resolution pops the item and parks the entry (census row A).
    resolveTopOfStack(state);
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-permanents");
    expect(head.asEntersCardId).toBe(recipientItem.id);
    expect(head.asEntersKind).toBe("copy");
    expect(head.allControllers).toBe(true);
    // Stackless (ADR 0100 D5) — the answer is committed onto the staged
    // permanent, never into a stack item's `collectedChoices`.
    expect(head.stackItemId).toBe("");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: targetInstanceId === null ? [] : [targetInstanceId],
    });
}
