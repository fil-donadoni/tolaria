// "Life gained this turn" tally (CR 119.3, issue #1457).
//
// CR 119.3 — "…a player gains life…". The engine already emits LIFE_GAINED at
// the single gain choke point (`gainLifeEmitting`), which answers the PROMPT
// question ("whenever you gain life"). The RETROSPECTIVE question — "if you
// gained life this turn", the CR 603.4 intervening-if shape used by Crested
// Sunmare / Ocelot Pride / Resplendent Angel — needs an accumulated per-player
// per-turn tally instead. `GameState.lifeGainedThisTurn` is that tally: it is
// incremented at the SAME choke point (so every sink, lifelink included, is
// covered by construction), holds the POST-replacement amount, and resets at
// the turn boundary.
import { describe, it, expect } from "vitest";
import type { CardInstanceState } from "../state";
import type { CardType } from "../../cards/types";
import {
    applyLifelinkLifeGain,
    gainLifeEmitting,
    loseLifeEmitting,
    buildSpellContext,
} from "../state";
import { advancePhase } from "../phases";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

function state2p() {
    return makeState({
        activePlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
}

describe("lifeGainedThisTurn tally (CR 119.3)", () => {
    it("accumulates per player across several gains", () => {
        const state = state2p();
        gainLifeEmitting(state, "p1", 3);
        gainLifeEmitting(state, "p1", 4);
        gainLifeEmitting(state, "p2", 2);
        expect(state.lifeGainedThisTurn).toEqual({ p1: 7, p2: 2 });
        expect(state.players[0].life).toBe(27);
        expect(state.players[1].life).toBe(22);
    });

    it("gaining 0 life does NOT count as having gained life (CR 119.3)", () => {
        const state = state2p();
        gainLifeEmitting(state, "p1", 0);
        expect(state.lifeGainedThisTurn?.p1 ?? 0).toBe(0);
        expect(state.lifeGainedThisTurn).toBeUndefined();
    });

    it("losing life never touches the gain tally", () => {
        const state = state2p();
        loseLifeEmitting(state, "p1", 5);
        expect(state.lifeGainedThisTurn).toBeUndefined();
    });

    it("the CR 702.15b lifelink gain funnels into the tally too", () => {
        const state = state2p();
        applyLifelinkLifeGain(state, "p1", ["lifelink"], 6);
        expect(state.lifeGainedThisTurn).toEqual({ p1: 6 });
        // A source WITHOUT lifelink gains nothing and tallies nothing.
        applyLifelinkLifeGain(state, "p2", ["flying"], 6);
        expect(state.lifeGainedThisTurn?.p2 ?? 0).toBe(0);
    });

    it("resets at the turn boundary (advanceTurn)", () => {
        const state = state2p();
        gainLifeEmitting(state, "p1", 4);
        expect(state.lifeGainedThisTurn?.p1).toBe(4);
        // Walk into the next turn via CLEANUP.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.lifeGainedThisTurn).toBeUndefined();
    });

    it("SpellContext.getLifeGainedThisTurn reads the tally back (0 when absent)", () => {
        const state = state2p();
        const source: CardInstanceState = {
            id: "src",
            card: { id: "def-src" },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
            isTapped: false,
        };
        state.stack.push({ ...source, castById: "p1" });
        const ctx = buildSpellContext(state, state.stack[0]);
        expect(ctx.getLifeGainedThisTurn("p1")).toBe(0);
        gainLifeEmitting(state, "p1", 9);
        expect(ctx.getLifeGainedThisTurn("p1")).toBe(9);
        expect(ctx.getLifeGainedThisTurn("p2")).toBe(0);
    });
});
