// Simultaneous-loss draw in the game-over SBA (CR 704.5 / CR 104.4a).
//
// CR 704.5 — all loss conditions are checked simultaneously in a single SBA
// sweep, not one player at a time. CR 104.4a — if all the players remaining in
// the game lose simultaneously, the game ends in a draw (no winner, no loser).
// This exercises checkGameOverSBA collecting EVERY player meeting a loss
// condition in one sweep, and the CR 614 loss-replacement carve-out that breaks
// simultaneity (a saved player → single loser → normal win).
import { beforeAll, describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { checkGameOverSBA } from "../sba";

// Synthetic permanent carrying a "you don't lose the game from life-zero"
// replacement (CR 614) — used to save one of two simultaneously-dying players,
// which must collapse the draw back into a normal single-loser win.
const LIFE_WARD_ID = "test:life-ward";
const lifeWard: CardDefinition = {
    id: LIFE_WARD_ID,
    name: "Test Life Ward",
    oracleText: "You don't lose the game for having zero or less life.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "life-ward-no-lose",
            oracleText: "You don't lose the game for having zero or less life.",
            eventKind: "lose-game",
            appliesTo: (event, self) => {
                if (event.kind !== "lose-game") return false;
                if (event.reason !== "life-zero") return false;
                return event.playerId === self.controllerId;
            },
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(lifeWard);
});

describe("simultaneous loss → draw (CR 704.5 / CR 104.4a)", () => {
    it("both players at <=0 life in the same sweep → draw, no winner/loser", () => {
        // e.g. Hurricane for X >= both life totals: both hit life <= 0 in the
        // same SBA sweep. CR 104.4a: all remaining players lose → draw.
        const state = makeState();
        state.players[0].life = 0;
        state.players[1].life = -3;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBe(true);
        expect(state.gameOver?.reason).toBe("draw");
        expect(state.gameOver?.winnerId).toBe("");
        expect(state.gameOver?.loserId).toBe("");
    });

    it("both players decked in the same sweep → draw", () => {
        const state = makeState();
        state.players[0].hasDrawnFromEmpty = true;
        state.players[1].hasDrawnFromEmpty = true;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBe(true);
        expect(state.gameOver?.reason).toBe("draw");
    });

    it("both players at ten+ poison in the same sweep → draw", () => {
        const state = makeState();
        state.players[0].poisonCounters = 10;
        state.players[1].poisonCounters = 11;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBe(true);
    });

    it("mixed loss reasons (one life, one poison) still draw", () => {
        const state = makeState();
        state.players[0].life = 0;
        state.players[1].poisonCounters = 10;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBe(true);
        expect(state.gameOver?.reason).toBe("draw");
    });

    it("single loser path is unchanged: opponent wins, no draw", () => {
        const state = makeState();
        state.players[1].life = 0;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBeUndefined();
        expect(state.gameOver?.reason).toBe("life");
        expect(state.gameOver?.loserId).toBe("p2");
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("a CR 614 loss replacement saving one player breaks simultaneity → normal win", () => {
        // Both players would die to life-zero, but p1 controls a "you don't
        // lose the game" replacement. That carve-out runs BEFORE p1 is counted
        // as a loser, so only p2 loses — single loser, p1 wins, not a draw.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.players[0].life = -2;
        state.players[1].life = -2;
        state.players[0].battlefield.push(
            makeInstance(LIFE_WARD_ID, {
                id: "ward",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.isDraw).toBeUndefined();
        expect(state.gameOver?.reason).toBe("life");
        expect(state.gameOver?.loserId).toBe("p2");
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("no loss condition → game continues (no gameOver)", () => {
        const state = makeState();
        expect(checkGameOverSBA(state)).toBe(false);
        expect(state.gameOver).toBeUndefined();
    });
});
