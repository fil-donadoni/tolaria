// Issue #3616 — the client's "does this click answer anything?" gate reads the
// engine's own Expected Input derivation (ADR 0047), so it must count every
// input the server waits on, not only a Priority window: a blocker
// declaration (CR 509.1) and a non-active combat-damage assigner
// (CR 510.1c / 702.22j-k) are owed input even though neither holds Priority.
import { describe, it, expect } from "vitest";
import {
    expectedInputAdmits,
    viewerOwesInput,
    type ExpectedInputView,
} from "../expected-input";

const base: ExpectedInputView = {
    activePlayerId: "ap",
    priorityPlayerId: "ap",
    phase: "PRECOMBAT_MAIN",
    allPlayers: [{ id: "ap" }, { id: "nap" }],
};

describe("viewerOwesInput / expectedInputAdmits (issue #3616, ADR 0047)", () => {
    it("a Priority window is owed by the priority player only", () => {
        expect(viewerOwesInput(base, "ap")).toBe(true);
        expect(viewerOwesInput(base, "nap")).toBe(false);
        expect(
            expectedInputAdmits(base, { playerId: "nap", expect: "priority" })
        ).toBe(false);
    });

    it("CR 509.1 — the defender owes the blocker declaration while the attacker holds priority", () => {
        const view: ExpectedInputView = {
            ...base,
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["bear"],
                blockersConfirmed: false,
            } as unknown as ExpectedInputView["combat"],
        };
        expect(viewerOwesInput(view, "nap")).toBe(true);
        expect(viewerOwesInput(view, "ap")).toBe(false);
        // A cast is not what that window waits for.
        expect(
            expectedInputAdmits(view, { playerId: "nap", expect: "priority" })
        ).toBe(false);
    });

    it("CR 510.1c — a non-active damage assigner owes input inside the active player's priority window", () => {
        const view: ExpectedInputView = {
            ...base,
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear"],
                damageConfirmed: false,
                damageAssignerIds: { bear: "nap" },
            } as unknown as ExpectedInputView["combat"],
        };
        expect(viewerOwesInput(view, "nap")).toBe(true);
    });

    it("CR 601.2c — the chooser owes a target selection", () => {
        const view: ExpectedInputView = {
            ...base,
            pendingTarget: {
                playerId: "nap",
                cardInstanceId: "bolt",
                targetType: "any",
            } as unknown as ExpectedInputView["pendingTarget"],
        };
        expect(viewerOwesInput(view, "nap")).toBe(true);
        expect(viewerOwesInput(view, "ap")).toBe(false);
    });

    it("a finished game owes nothing (CR 104)", () => {
        const view: ExpectedInputView = {
            ...base,
            gameOver: {
                winnerId: "ap",
            } as unknown as ExpectedInputView["gameOver"],
        };
        expect(viewerOwesInput(view, "ap")).toBe(false);
    });
});
