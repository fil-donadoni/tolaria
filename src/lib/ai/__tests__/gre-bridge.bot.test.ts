// Proves the shared GRE package is importable and runnable from client code
// (ADR 0001, issue #108 — acceptance: "GRE is importable from client code via
// a shared package"). If the client tsconfig/bundler cannot resolve or compile
// the engine, this test fails to even import.
import { describe, expect, it } from "vitest";
import { cloneGameState, advancePhase } from "../gre-bridge";
import type { GameState } from "../gre-bridge";

function minimalState(): GameState {
    return {
        players: [
            {
                id: "p1",
                name: "p1",
                bgColor: "#000",
                life: 20,
                hand: [],
                library: [],
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            },
            {
                id: "p2",
                name: "p2",
                bgColor: "#000",
                life: 20,
                hand: [],
                library: [],
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            },
        ],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
    };
}

describe("shared GRE bridge (client import, issue #108)", () => {
    it("imports and runs the engine clone from client code", () => {
        const state = minimalState();
        const clone = cloneGameState(state);
        expect(clone).not.toBe(state);
        expect(clone).toEqual(state);
    });

    it("can step the real engine forward on a client-held state", () => {
        const state = minimalState();
        const before = state.phase;
        advancePhase(state);
        expect(state.phase).not.toBe(before);
    });
});
