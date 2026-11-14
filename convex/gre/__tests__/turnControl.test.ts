// Turn Control (CR 723, ADR 0181) — the state, its lifecycle at the turn
// boundary, and the Acting Player map every decision boundary reads.
//
// The rules never read `turnControls`: these tests pin BOTH halves — that the
// map answers "who decides for this seat" correctly, and that the seat-level
// answers the rules read (`computeOwedPlayerIds`, the Expected Input gate,
// the active player) do not move.

import { describe, expect, it } from "vitest";
import { makeState } from "../../cards/__tests__/setup.helper";
import { phaseStopSkips } from "../autoPass";
import {
    actedSeatFor,
    assertExpectedInput,
    computeExpectedInput,
    computeOwedActingPlayerIds,
    computeOwedPlayerIds,
} from "../expectedInput";
import { advancePhase } from "../phases";
import type { GameState } from "../state";
import {
    actingPlayerFor,
    activeTurnControls,
    createTurnControl,
    isControlledByAnother,
    scheduleExtraTurn,
    seatsActedBy,
} from "../turnControl";

/** Crosses one turn boundary: the active player's END_STEP → the next turn. */
function crossTurn(state: GameState): void {
    state.phase = "END_STEP";
    state.stack = [];
    advancePhase(state);
}

describe("Turn Control lifecycle (CR 723.1)", () => {
    it("waits for the controlled player's next turn, lasts that entire turn, and ends at the beginning of the next (CR 723.1)", () => {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        // Pending during the controller's own turn: p2 still decides.
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        expect(activeTurnControls(state)).toBeUndefined();

        crossTurn(state);
        expect(state.activePlayerId).toBe("p2");
        expect(actingPlayerFor(state, "p2")).toBe("p1");
        expect(isControlledByAnother(state, "p2")).toBe(true);
        expect(activeTurnControls(state)).toEqual([
            { controlledId: "p2", controllerId: "p1", active: true },
        ]);

        crossTurn(state);
        expect(state.activePlayerId).toBe("p1");
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        expect(state.turnControls).toBeUndefined();
    });

    it("an effect created during the affected player's own turn applies to their NEXT turn, not the one in progress (CR 723.1)", () => {
        const state = makeState({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });
        createTurnControl(state, "p1", "p2");
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        crossTurn(state); // p1's turn
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        crossTurn(state); // p2's next turn
        expect(state.activePlayerId).toBe("p2");
        expect(actingPlayerFor(state, "p2")).toBe("p1");
    });

    it("a skipped turn does not consume the effect — it waits for the turn actually taken (CR 723.1b)", () => {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        state.players[1].skipNextTurn = 1;

        crossTurn(state); // p2's turn is skipped: p1 again
        expect(state.activePlayerId).toBe("p1");
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        expect(state.turnControls).toEqual([
            { controlledId: "p2", controllerId: "p1" },
        ]);

        crossTurn(state); // the turn p2 actually takes
        expect(state.activePlayerId).toBe("p2");
        expect(actingPlayerFor(state, "p2")).toBe("p1");
    });

    it("effects on the same player overwrite each other — the last one created works (CR 723.1a)", () => {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        createTurnControl(state, "p2", "p2");
        expect(state.turnControls).toEqual([
            { controlledId: "p2", controllerId: "p2" },
        ]);
        crossTurn(state);
        // CR 723.9 — control of themselves: they decide as normal.
        expect(actingPlayerFor(state, "p2")).toBe("p2");
        expect(isControlledByAnother(state, "p2")).toBe(false);
    });

    it("an effect created during a controlled turn leaves that turn's control standing and takes the following one", () => {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        crossTurn(state);
        expect(actingPlayerFor(state, "p2")).toBe("p1");
        createTurnControl(state, "p2", "p2");
        // Still p1's to decide this turn.
        expect(actingPlayerFor(state, "p2")).toBe("p1");
        crossTurn(state); // p1's turn
        expect(state.turnControls).toEqual([
            { controlledId: "p2", controllerId: "p2" },
        ]);
    });
});

describe("the Acting Player map (CR 723.5, 723.8)", () => {
    function controlledTurn(): GameState {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        crossTurn(state);
        // Land on a priority window of the controlled turn.
        state.phase = "PRECOMBAT_MAIN";
        state.priorityPlayerId = "p2";
        state.passCount = 0;
        return state;
    }

    it("the controller answers for both seats, the controlled player for none (CR 723.8)", () => {
        const state = controlledTurn();
        expect(seatsActedBy(state, "p1")).toEqual(["p1", "p2"]);
        expect(seatsActedBy(state, "p2")).toEqual([]);
    });

    it("only control of the player changes: the controlled player is still active and still the seat the rules name (CR 723.3)", () => {
        const state = controlledTurn();
        expect(state.activePlayerId).toBe("p2");
        expect(computeExpectedInput(state)).toEqual({
            kind: "priority",
            playerId: "p2",
        });
        expect(computeOwedPlayerIds(state)).toEqual(["p2"]);
        // The gate keeps authorising the SEAT: an action is submitted as p2.
        expect(() =>
            assertExpectedInput(state, { playerId: "p2", expect: "priority" })
        ).not.toThrow();
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "priority" })
        ).toThrow(/another player/);
    });

    it("the player owed to ANSWER is the controller, acting as the controlled seat (CR 723.5)", () => {
        const state = controlledTurn();
        expect(computeOwedActingPlayerIds(state)).toEqual(["p1"]);
        expect(actedSeatFor(state, "p1")).toBe("p2");
        expect(actedSeatFor(state, "p2")).toBeNull();
        // The controller's own window in the same turn is theirs as ever.
        state.priorityPlayerId = "p1";
        expect(computeOwedActingPlayerIds(state)).toEqual(["p1"]);
        expect(actedSeatFor(state, "p1")).toBe("p1");
    });

    it("with no Turn Control the map is the identity", () => {
        const state = makeState();
        expect(actingPlayerFor(state, "p1")).toBe("p1");
        expect(seatsActedBy(state, "p1")).toEqual(["p1"]);
        expect(computeOwedActingPlayerIds(state)).toEqual(
            computeOwedPlayerIds(state)
        );
        expect(actedSeatFor(state, "p1")).toBe("p1");
        expect(actedSeatFor(state, "p2")).toBeNull();
    });

    it("a controlled seat's Phase Stops are the controller's, never the controlled player's own (CR 723.5)", () => {
        const state = controlledTurn();
        state.phase = "UPKEEP";
        // p2 asked to skip their own upkeep; p1 asked to stop in theirs.
        state.seatSkipPrefs = {
            p2: { UPKEEP: { self: true, opponent: true } },
            p1: { UPKEEP: { self: false, opponent: true } },
        };
        expect(phaseStopSkips(state, "p2")).toBe(false);
        // …and the reverse: the controller's own-turn skip applies to it.
        state.seatSkipPrefs = {
            p2: { UPKEEP: { self: false, opponent: false } },
            p1: { UPKEEP: { self: true, opponent: false } },
        };
        expect(phaseStopSkips(state, "p2")).toBe(true);
    });
});

describe("an extra turn after a player's next turn (CR 500.7)", () => {
    it("is added directly after the next turn that player actually takes", () => {
        const state = makeState({ activePlayerId: "p1" });
        scheduleExtraTurn(state, "p2", "p2");
        expect(state.extraTurns).toBeUndefined();

        crossTurn(state); // p2's next turn: the entry is armed, nothing queued
        expect(state.activePlayerId).toBe("p2");
        expect(state.extraTurns).toBeUndefined();
        expect(state.scheduledExtraTurns).toEqual([
            { playerId: "p2", afterNextTurnOf: "p2", armed: true },
        ]);

        crossTurn(state); // …and p2 takes the extra turn right after it
        expect(state.activePlayerId).toBe("p2");
        expect(state.scheduledExtraTurns).toBeUndefined();
        expect(state.extraTurns).toBeUndefined();

        crossTurn(state); // then the turn order resumes
        expect(state.activePlayerId).toBe("p1");
    });

    it("waits for the first occurrence that is not skipped (CR 614.10a)", () => {
        const state = makeState({ activePlayerId: "p1" });
        scheduleExtraTurn(state, "p2", "p2");
        state.players[1].skipNextTurn = 1;
        crossTurn(state); // skipped: p1 again, still waiting
        expect(state.activePlayerId).toBe("p1");
        expect(state.scheduledExtraTurns).toEqual([
            { playerId: "p2", afterNextTurnOf: "p2" },
        ]);
        crossTurn(state); // p2's actual turn
        crossTurn(state); // p2's extra turn
        expect(state.activePlayerId).toBe("p2");
    });

    it("the extra turn after a controlled turn is NOT controlled (CR 723.1)", () => {
        const state = makeState({ activePlayerId: "p1" });
        createTurnControl(state, "p1", "p2");
        scheduleExtraTurn(state, "p2", "p2");
        crossTurn(state);
        expect(actingPlayerFor(state, "p2")).toBe("p1");
        crossTurn(state);
        expect(state.activePlayerId).toBe("p2");
        expect(actingPlayerFor(state, "p2")).toBe("p2");
    });
});
