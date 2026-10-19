// returnToHandAtNextUntap — CR 502.3 / 502.4 / 400.7 (issue #5509). The
// mechanic's own tests: the Op itself is covered in
// `effects/__tests__/interpreter.test.ts`; this file walks the untap step.

import { describe, it, expect } from "vitest";
import { advancePhase, untapStep } from "../phases";
import { removePermanentTo } from "../state";
import { compactState, expandState } from "../serialize";
import { reverseManaAbilityEffectsOnUntap } from "../manaAbilityEffects";
import { makeInstance, makeState } from "../../cards/__tests__/setup.helper";
import { goblinShrine } from "../../cards/sets/drk/red.cards";

/** Grizzly Bears — any vanilla permanent will do. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function markedLand(mark: string | undefined = "p1") {
    return makeInstance(BEARS, {
        id: "marked",
        isTapped: true,
        returnToHandAtUntapOf: mark,
    });
}

describe("returnToHandAtNextUntap (CR 502.3)", () => {
    it("CR 502.3 — the marked permanent stays through this turn and the opponent's turn, then returns to its owner's hand at the activator's next untap step", () => {
        const land = markedLand();
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        state.players[0].battlefield = [land];

        // Rest of p1's turn → all of p2's turn: still on the battlefield.
        advancePhase(state);
        while (!(state.activePlayerId === "p1" && state.turn >= 3)) {
            expect(state.players[0].battlefield).toContain(land);
            expect(state.players[0].hand).not.toContain(land);
            advancePhase(state);
        }
        // p1's next untap step has run.
        expect(state.players[0].battlefield).not.toContain(land);
        expect(state.players[0].hand.map((c) => c.id)).toContain("marked");
        const inHand = state.players[0].hand.find((c) => c.id === "marked")!;
        expect(inHand.returnToHandAtUntapOf).toBeUndefined();
    });

    it("CR 502.3 — the OTHER player's untap step does not consume the mark", () => {
        const land = markedLand("p1");
        const state = makeState({ phase: "UNTAP", activePlayerId: "p2" });
        state.players[0].battlefield = [land];
        untapStep(state);
        expect(state.players[0].battlefield).toContain(land);
        expect(land.returnToHandAtUntapOf).toBe("p1");
    });

    it("CR 502.3 / 502.4 — the return uses no stack item and grants no priority", () => {
        const land = markedLand();
        const state = makeState({ phase: "UNTAP", activePlayerId: "p1" });
        state.players[0].battlefield = [land];
        const priorityBefore = state.priorityPlayerId;
        untapStep(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("marked");
        expect(state.stack).toHaveLength(0);
        expect(state.priorityPlayerId).toBe(priorityBefore);
    });

    it("CR 502.4 / 503.1a — a leaves-the-battlefield trigger the return causes is on the stack when the upkeep priority window opens", () => {
        // Goblin Shrine — "When this Aura leaves the battlefield, it deals 1
        // damage to each Goblin creature." Marked, attached to a land.
        const host = makeInstance(BEARS, { id: "host" });
        const shrine = makeInstance(goblinShrine().id, {
            id: "shrine",
            attachedTo: "host",
            returnToHandAtUntapOf: "p1",
        });
        const state = makeState({ phase: "CLEANUP", activePlayerId: "p2" });
        state.players[0].battlefield = [host, shrine];
        const traversed = advancePhase(state);
        expect(traversed).toContain("UNTAP");
        expect(state.phase).toBe("UPKEEP");
        expect(state.players[0].hand.map((c) => c.id)).toContain("shrine");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0]!.triggerSourceId ?? state.stack[0]!.id).toBe(
            "shrine"
        );
    });

    it("CR 502.3 — unconditional: fires even when the permanent would not untap (skipNextUntap)", () => {
        const land = markedLand();
        land.skipNextUntap = true;
        const state = makeState({ phase: "UNTAP", activePlayerId: "p1" });
        state.players[0].battlefield = [land];
        untapStep(state);
        expect(state.players[0].battlefield).not.toContain(land);
        expect(state.players[0].hand.map((c) => c.id)).toContain("marked");
    });

    it("CR 400.7 — a permanent that leaves and re-enters before the untap step is a new object and is NOT returned", () => {
        const land = markedLand();
        const state = makeState({ phase: "UNTAP", activePlayerId: "p1" });
        state.players[0].battlefield = [land];
        removePermanentTo(state, "marked", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "marked")!;
        expect(inHand.returnToHandAtUntapOf).toBeUndefined();
        // Re-enter the battlefield.
        state.players[0].hand = [];
        inHand.zone = "battlefield";
        state.players[0].battlefield = [inHand];
        untapStep(state);
        expect(state.players[0].battlefield).toContain(inHand);
    });

    it("serialization — the mark survives a save round-trip", () => {
        const land = markedLand("p1");
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
        });
        state.players[0].battlefield = [land];
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].battlefield[0].returnToHandAtUntapOf).toBe(
            "p1"
        );
    });

    it("CR 106.4 — reversing the mana tap that armed the mark drops it", () => {
        const land = markedLand();
        reverseManaAbilityEffectsOnUntap(land);
        expect(land.returnToHandAtUntapOf).toBeUndefined();
    });
});
