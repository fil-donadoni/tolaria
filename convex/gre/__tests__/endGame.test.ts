import { describe, expect, it } from "vitest";
import { incinerate } from "../../cards/sets/ice/red.cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { buildSpellContext, endGame, type GameState } from "../state";
import { checkGameOverSBA } from "../sba";

function ctx(state: GameState) {
    return buildSpellContext(state, pushSpell(state, incinerate().id, "p1"));
}

describe("endGame — sole writer of state.gameOver", () => {
    it("records the outcome on the first call", () => {
        const state = makeState();
        const outcome = {
            winnerId: "p1",
            loserId: "p2",
            reason: "concede" as const,
        };
        expect(endGame(state, outcome)).toBe(true);
        expect(state.gameOver).toEqual(outcome);
    });

    it("a second call does not overwrite the first outcome", () => {
        const state = makeState();
        endGame(state, { winnerId: "p1", loserId: "p2", reason: "life" });
        const second = endGame(state, {
            winnerId: "p2",
            loserId: "p1",
            reason: "concede",
        });
        expect(second).toBe(false);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "life",
        });
    });

    it("loseGame after the game ended keeps the first outcome", () => {
        const state = makeState();
        ctx(state).winGame("p1");
        ctx(state).loseGame("p1");
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("an SBA loss does not replace an already-registered alternate win (CR 104.2a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 0 })],
        });
        ctx(state).winGame("p2");
        expect(state.gameOver?.reason).toBe("alternate-win");
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "alternate-win",
        });
    });
});

describe("outcome shapes recorded as before", () => {
    it("life loss (CR 704.5a)", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 0 }), makePlayer("p2")],
        });
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "life",
        });
    });

    it("decked (CR 704.5b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hasDrawnFromEmpty: true }),
                makePlayer("p2"),
            ],
        });
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "decked",
        });
    });

    it("poison (CR 704.5c)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { poisonCounters: 10 }),
                makePlayer("p2"),
            ],
        });
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "poison",
        });
    });

    it("simultaneous loss is a draw (CR 104.4a)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 0 }),
                makePlayer("p2", { life: 0 }),
            ],
        });
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "",
            loserId: "",
            reason: "draw",
            isDraw: true,
        });
    });

    it("loseGame / drawGame / winGame contexts", () => {
        const lose = makeState();
        ctx(lose).loseGame("p1");
        expect(lose.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "life",
        });
        const draw = makeState();
        ctx(draw).drawGame();
        expect(draw.gameOver).toEqual({
            winnerId: "",
            loserId: "",
            reason: "draw",
            isDraw: true,
        });
        const win = makeState();
        ctx(win).winGame("p1");
        expect(win.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});
