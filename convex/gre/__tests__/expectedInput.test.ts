// Authoritative Expected Input (ADR 0047, issue #796) — the field, its
// bookkeeping, the coherence invariant, and its survival through the public
// projection. Gating against `expectedInput` is a separate slice (#799) and is
// not exercised here.

import { describe, expect, it } from "vitest";
import {
    computeExpectedInput,
    refreshExpectedInput,
    assertExpectedInputCoherent,
} from "../expectedInput";
import { makeState } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import type { GameState, PendingChoice } from "../state";

/** Builds a minimal combat block that has declared attackers. */
function combatWithAttackers(
    overrides: Partial<NonNullable<GameState["combat"]>> = {}
): NonNullable<GameState["combat"]> {
    return {
        attackerIds: ["atk1"],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...overrides,
    };
}

const choice: PendingChoice = {
    stackItemId: "s1",
    step: 0,
    choiceId: "p2",
    playerId: "p2",
    kind: "may-pay",
    count: 1,
    prompt: "Pay?",
};

describe("computeExpectedInput — variant selection (ADR 0047)", () => {
    it("priority: default waiting state hands off to the priority player (CR 117)", () => {
        const state = makeState({ priorityPlayerId: "p2" });
        expect(computeExpectedInput(state)).toEqual({
            kind: "priority",
            playerId: "p2",
        });
    });

    it("choice: a head PendingChoice (CR 608.2) outranks priority", () => {
        const state = makeState({
            priorityPlayerId: "p1",
            pendingChoices: [choice],
        });
        expect(computeExpectedInput(state)).toEqual({
            kind: "choice",
            playerId: "p2",
            stackItemId: "s1",
            choiceId: "p2",
            choiceKind: "may-pay",
        });
    });

    it("choice: FIFO front is the awaited entry (APNAP order)", () => {
        const second: PendingChoice = {
            ...choice,
            choiceId: "p1",
            playerId: "p1",
        };
        const state = makeState({ pendingChoices: [choice, second] });
        expect(computeExpectedInput(state)).toMatchObject({
            kind: "choice",
            playerId: "p2",
        });
    });

    it("target: a pending target wait (CR 601.2c) outranks priority", () => {
        const state = makeState({
            priorityPlayerId: "p1",
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "bolt-1",
                targetType: "Creature",
                count: 1,
                selected: [],
            },
        });
        expect(computeExpectedInput(state)).toEqual({
            kind: "target",
            playerId: "p1",
            cardInstanceId: "bolt-1",
            targetType: "Creature",
        });
    });

    it("choice outranks target when both are present (precedence)", () => {
        const state = makeState({
            pendingChoices: [choice],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "bolt-1",
                targetType: "Creature",
                count: 1,
                selected: [],
            },
        });
        expect(computeExpectedInput(state)?.kind).toBe("choice");
    });

    it("cast/activation payment in progress maps to priority (CR 117)", () => {
        // pendingCast/pendingActivation have no dedicated variant: the payer
        // holds priority while paying, so the state maps to `priority`.
        const state = makeState({
            priorityPlayerId: "p1",
            pendingCast: {
                playerId: "p1",
                cardInstanceId: "bolt-1",
                manaCost: { R: 1 },
                tappedLandIds: [],
            },
        });
        expect(computeExpectedInput(state)).toEqual({
            kind: "priority",
            playerId: "p1",
        });
    });

    it("blockers: defending player declares blockers this combat (CR 509.1)", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            combat: combatWithAttackers(),
        });
        expect(computeExpectedInput(state)).toEqual({
            kind: "blockers",
            playerId: "p2",
        });
    });

    it("blockers: Melee routes block declaration to the attacking player (#669)", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            meleeCombat: true,
            combat: combatWithAttackers(),
        });
        expect(computeExpectedInput(state)).toEqual({
            kind: "blockers",
            playerId: "p1",
        });
    });

    it("blockers: once confirmed, the step reverts to priority", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: combatWithAttackers({ blockersConfirmed: true }),
        });
        expect(computeExpectedInput(state)?.kind).toBe("priority");
    });

    it("blockers: an attackerless declare-blockers step is not a blocker wait", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            combat: combatWithAttackers({ attackerIds: [] }),
        });
        expect(computeExpectedInput(state)?.kind).toBe("priority");
    });

    it("game over is awaited by no one (CR 104)", () => {
        const state = makeState({
            gameOver: { winnerId: "p1", loserId: "p2", reason: "life" },
        });
        expect(computeExpectedInput(state)).toBeUndefined();
    });
});

describe("refreshExpectedInput — engine maintains the field", () => {
    it("sets the field and clears it as the waiting state changes", () => {
        const state = makeState({ pendingChoices: [choice] });
        refreshExpectedInput(state);
        expect(state.expectedInput).toMatchObject({ kind: "choice" });

        // Dequeue the choice — the field must be recomputed, not stale.
        state.pendingChoices = [];
        refreshExpectedInput(state);
        expect(state.expectedInput).toEqual({
            kind: "priority",
            playerId: "p1",
        });
    });

    it("clears to undefined on game over", () => {
        const state = makeState({});
        expect(state.expectedInput).toBeDefined();
        state.gameOver = { winnerId: "p1", loserId: "p2", reason: "concede" };
        refreshExpectedInput(state);
        expect(state.expectedInput).toBeUndefined();
    });
});

describe("assertExpectedInputCoherent — runtime invariant", () => {
    it("passes when the field agrees with the pending state", () => {
        const state = makeState({ pendingChoices: [choice] });
        expect(() => assertExpectedInputCoherent(state)).not.toThrow();
    });

    it("passes vacuously when the field is absent (not yet materialized)", () => {
        const state = makeState({});
        state.expectedInput = undefined;
        expect(() => assertExpectedInputCoherent(state)).not.toThrow();
    });

    it("throws when the field contradicts the pending state", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        // Claim we're waiting on a choice while no choice is pending.
        state.expectedInput = {
            kind: "choice",
            playerId: "p2",
            stackItemId: "s1",
            choiceId: "p2",
            choiceKind: "may-pay",
        };
        expect(() => assertExpectedInputCoherent(state)).toThrow(/incoherent/i);
    });

    it("throws when the field names the wrong player", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        state.expectedInput = { kind: "priority", playerId: "p2" };
        expect(() => assertExpectedInputCoherent(state)).toThrow(/incoherent/i);
    });
});

describe("wire format — expectedInput survives the public projection", () => {
    it("projects the choice variant onto the wire (ADR 0047)", () => {
        const state = makeState({ pendingChoices: [choice] });
        // Sanity: the fat state carries the field.
        expect(state.expectedInput).toMatchObject({ kind: "choice" });

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p2",
            stackItemId: "s1",
            choiceId: "p2",
            choiceKind: "may-pay",
        });
    });

    it("projects the priority variant onto the wire", () => {
        const state = makeState({ priorityPlayerId: "p2" });
        const projected = projectPublicState(state, 3, "p1");
        expect(projected.expectedInput).toEqual({
            kind: "priority",
            playerId: "p2",
        });
    });
});
