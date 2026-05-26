// London mulligan engine tests (CR 103.5).
//
// These tests exercise the pure engine functions in `convex/gre/mulligan.ts`
// directly: state shape, declaration sequencing, simultaneous reshuffle/redraw,
// bottoming via PendingChoice, and the transition to UPKEEP of turn 1. The
// Convex mutation wrapper is covered by integration paths, not here.

import { describe, expect, it } from "vitest";
import {
    applyMulliganBottomChoice,
    enterBottomingPhase,
    finalizeMulligan,
    makeMulliganState,
    recordDeclaration,
} from "../mulligan";
import type { GameState } from "../state";
import type { Phase } from "../types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const STARTING_HAND_SIZE = 7;
const ARMAGEDDON_ID = "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb";

/** Build a 2-player game state ready for the mulligan phase: each player
 *  has a 60-card library of identical placeholder cards and the standard
 *  starting 7-card hand drawn off the top. */
function makeMulliganGame(rngSeed = 1): GameState {
    const buildPlayer = (id: string) => {
        // Deterministic instance ids so identical seeds produce identical
        // shuffle outcomes when comparing across two fixture invocations.
        const library = Array.from({ length: 60 }, (_, i) =>
            makeInstance(ARMAGEDDON_ID, {
                id: `${id}-card-${i}`,
                controllerId: id,
                ownerId: id,
                zone: "library",
            })
        );
        const hand = library.splice(0, STARTING_HAND_SIZE).map((c) => ({
            ...c,
            zone: "hand" as const,
        }));
        return makePlayer(id, { hand, library });
    };

    const state = makeState({
        players: [buildPlayer("p1"), buildPlayer("p2")],
        phase: "MULLIGAN" as Phase,
        rngSeed,
        rngCounter: 0,
        priorityPlayerId: "p1",
    });
    state.mulligan = makeMulliganState(state);
    return state;
}

describe("london mulligan (CR 103.5)", () => {
    it("starts with starting player declaring first", () => {
        const state = makeMulliganGame();
        expect(state.phase).toBe("MULLIGAN");
        expect(state.mulligan?.declaringPlayerId).toBe("p1");
        expect(state.mulligan?.mulligansTaken).toEqual([0, 0]);
        expect(state.mulligan?.locked).toEqual([false, false]);
    });

    it("both keep on the first round → advances to UPKEEP, no bottoming", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "keep");
        // After p1 keeps, p2 declares next.
        expect(state.mulligan?.declaringPlayerId).toBe("p2");
        recordDeclaration(state, "p2", "keep");
        // Round executes: both lock, no bottoming → finalize advances phase.
        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(state.players[0].hand).toHaveLength(STARTING_HAND_SIZE);
        expect(state.players[1].hand).toHaveLength(STARTING_HAND_SIZE);
    });

    it("p1 mulls once then keeps; p2 keeps → bottoming for p1 only", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");

        // Round executed: p1 reshuffled + redrew 7, p2 locked. p1 declares
        // again next round.
        expect(state.mulligan?.mulligansTaken).toEqual([1, 0]);
        expect(state.mulligan?.locked).toEqual([false, true]);
        expect(state.mulligan?.declaringPlayerId).toBe("p1");
        expect(state.players[0].hand).toHaveLength(STARTING_HAND_SIZE);
        expect(state.players[0].library).toHaveLength(60 - STARTING_HAND_SIZE);

        // p1 keeps → bottoming queued for p1 only with count = 1.
        recordDeclaration(state, "p1", "keep");
        expect(state.mulligan?.bottoming).toBe(true);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "mulligan-bottom",
            playerId: "p1",
            count: 1,
            zone: "hand",
        });
        // Priority must have moved to the chooser for the bottoming step.
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("both mull simultaneously; both keep round 2 → bottoming p1 then p2", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "mull");

        expect(state.mulligan?.mulligansTaken).toEqual([1, 1]);
        expect(state.mulligan?.locked).toEqual([false, false]);
        expect(state.mulligan?.declaringPlayerId).toBe("p1");

        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "keep");

        // Both bottoming choices queued, p1 first (APNAP).
        expect(state.pendingChoices).toHaveLength(2);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
        expect(state.pendingChoices?.[1].playerId).toBe("p2");
        expect(state.pendingChoices?.[0].count).toBe(1);
        expect(state.pendingChoices?.[1].count).toBe(1);
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("applyMulliganBottomChoice moves picks to library bottom and advances", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");

        expect(state.pendingChoices).toHaveLength(1);
        const p1 = state.players[0];
        const initialLibLength = p1.library.length;
        const handIdsBeforeBottom = p1.hand.map((c) => c.id);
        const pickedId = handIdsBeforeBottom[0];

        // Simulate the player picking one card.
        applyMulliganBottomChoice(state, [pickedId]);

        // Phase advanced to UPKEEP (turn 1) — finalize ran.
        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(state.pendingChoices).toBeUndefined();
        expect(p1.hand).toHaveLength(STARTING_HAND_SIZE - 1);
        // The picked card landed at the bottom of the library (last index).
        expect(p1.library).toHaveLength(initialLibLength + 1);
        expect(p1.library[p1.library.length - 1].id).toBe(pickedId);
        // Total cards (hand + library) returns to 60 — no card left the deck.
        expect(p1.hand.length + p1.library.length).toBe(60);
    });

    it("rejects declarations out of turn order", () => {
        const state = makeMulliganGame();
        expect(() => recordDeclaration(state, "p2", "keep")).toThrow(
            /Not your turn to declare/
        );
    });

    it("forbids declaring after the player is locked", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "keep");
        recordDeclaration(state, "p2", "keep");
        // Mulligan finalized — declaration mutation should be rejected.
        expect(state.mulligan).toBeUndefined();
        expect(() => recordDeclaration(state, "p1", "mull")).toThrow(
            /Mulligan state missing/
        );
    });

    it("forbids declaring during bottoming", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");
        // Bottoming queued — declarations should be rejected now.
        expect(state.mulligan?.bottoming).toBe(true);
        expect(() => recordDeclaration(state, "p1", "keep")).toThrow(
            /during bottoming/
        );
    });

    it("forced lock when mulligansTaken reaches starting hand size", () => {
        const state = makeMulliganGame();
        // p2 locks early so p1 is the only declarer.
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        // p1 keeps mulling until forced lock at mulligansTaken = 7.
        for (let i = 1; i < STARTING_HAND_SIZE; i++) {
            recordDeclaration(state, "p1", "mull");
        }
        // After the 7th mull, p1 is force-locked → bottoming queued with
        // count clamped to hand size (still 7 cards in hand at this point).
        expect(state.mulligan?.bottoming).toBe(true);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
        expect(state.pendingChoices?.[0].count).toBe(STARTING_HAND_SIZE);
    });

    it("library + hand totals are preserved across reshuffle/redraw", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "mull");
        // After simultaneous reshuffle + redraw, each player still owns 60.
        for (const p of state.players) {
            expect(p.hand.length + p.library.length).toBe(60);
        }
    });

    it("determinism — identical seeds produce identical hands after a mulligan", () => {
        const a = makeMulliganGame(42);
        const b = makeMulliganGame(42);
        recordDeclaration(a, "p1", "mull");
        recordDeclaration(a, "p2", "keep");
        recordDeclaration(b, "p1", "mull");
        recordDeclaration(b, "p2", "keep");

        const handAIds = a.players[0].hand.map((c) => c.id);
        const handBIds = b.players[0].hand.map((c) => c.id);
        expect(handAIds).toEqual(handBIds);
        expect(a.rngCounter).toBe(b.rngCounter);
    });

    it("enterBottomingPhase finalizes immediately when no one mulled", () => {
        // Construct an artificial state where everyone is already locked but
        // no one has mulligansTaken > 0 — finalize should fire on entry.
        const state = makeMulliganGame();
        const m = state.mulligan!;
        m.locked = [true, true];
        enterBottomingPhase(state);
        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
    });

    it("finalizeMulligan transitions cleanly to UPKEEP for turn 1", () => {
        const state = makeMulliganGame();
        finalizeMulligan(state);
        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(state.turn).toBe(1);
    });
});
