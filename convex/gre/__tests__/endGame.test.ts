import { describe, expect, it } from "vitest";
import { incinerate } from "../../cards/sets/ice/red.cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { buildSpellContext, endGame, type GameState } from "../state";
import { checkGameOverSBA } from "../sba";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import { lich } from "../../cards/sets/lea/black.cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    LoseGameReplacementEvent,
} from "../../cards/types";

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

    it("an SBA loss does not replace an already-registered alternate win (CR 104.2b)", () => {
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

// CR 704.5b / CR 614 (issue #3231) — the decked loss is routed through the
// same loss-replacement framework as life-zero and poison.
describe("decked loss goes through the CR 614 loss replacements", () => {
    const SAVIOR = "test-decked-loss-savior";
    function saviorDef(seen: LoseGameReplacementEvent[]): CardDefinition {
        return {
            id: SAVIOR,
            name: "Decked Loss Savior",
            rarity: "rare",
            manaCost: { X: 1 },
            types: ["Enchantment"],
            oracleText:
                "You don't lose the game for drawing from an empty library.",
            replacementEffects: [
                {
                    id: "test-decked-savior",
                    oracleText:
                        "You don't lose the game for drawing from an empty library.",
                    eventKind: "lose-game",
                    appliesTo: (event, self) => {
                        if (event.kind !== "lose-game") return false;
                        seen.push(event);
                        return (
                            event.reason === "decked" &&
                            event.playerId === self.controllerId
                        );
                    },
                    replace: () => ({ kind: "consumed" }),
                },
            ],
        };
    }

    it('a replacement scoped to "decked" sees the event and consumes the loss', () => {
        const seen: LoseGameReplacementEvent[] = [];
        withTemporaryDefinition(saviorDef(seen), () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hasDrawnFromEmpty: true,
                        battlefield: [makeInstance(SAVIOR, { id: "savior" })],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(checkGameOverSBA(state)).toBe(false);
            expect(state.gameOver).toBeUndefined();
            expect(seen).toContainEqual({
                kind: "lose-game",
                playerId: "p1",
                reason: "decked",
            });
            // CR 704.5b — "since the last time state-based actions were
            // checked": the consumed attempt closes the window, so the next
            // sweep (savior still there or not) finds no loss.
            expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        });
    });

    it("a consumed decked loss still checks poison in the same sweep", () => {
        withTemporaryDefinition(saviorDef([]), () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hasDrawnFromEmpty: true,
                        poisonCounters: 10,
                        battlefield: [makeInstance(SAVIOR, { id: "savior" })],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(checkGameOverSBA(state)).toBe(true);
            expect(state.gameOver?.reason).toBe("poison");
        });
    });

    it("an unreplaced decked loss is unchanged: Lich (scoped to life-zero) does not save it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hasDrawnFromEmpty: true,
                    battlefield: [makeInstance(lich().id, { id: "lich" })],
                }),
                makePlayer("p2"),
            ],
        });
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "decked",
        });
    });
});
