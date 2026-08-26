// Counters cease to exist on a zone change (CR 122.2 / 400.7).
//
// The engine used to PRESERVE `counters` on a battlefield → graveyard/exile
// move so death triggers could read the moment-of-death count. That leaked the
// live map into every consumer that reads a card in a non-battlefield zone —
// most visibly the board UI, which rendered a "+1/+1" badge on a creature
// sitting in the graveyard.
//
// The split: `counters` is now battlefield-only and stripped at
// `leaveBattlefield` (the single funnel for every departure — dies, sacrifice,
// destroy, bounce, exile), while the departure-time snapshot moves to
// `countersAtLeave`, which is last-known information only (CR 608.2h).

import { describe, it, expect } from "vitest";
import { addCounterToCard, removePermanentTo, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { compactState, expandState } from "../serialize";

function withCounteredBear(): GameState {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")],
    });
    addCounterToCard(state, bear, "+1/+1", 2);
    return state;
}

function findIn(
    state: GameState,
    zone: "graveyard" | "exile" | "hand" | "battlefield"
) {
    return state.players[0][zone].find((c) => c.id === "bear");
}

describe("counters cease to exist on a zone change (CR 122.2 / 400.7)", () => {
    it("holds the counters while the permanent is on the battlefield", () => {
        const state = withCounteredBear();
        expect(findIn(state, "battlefield")!.counters).toEqual({ "+1/+1": 2 });
    });

    for (const zone of ["graveyard", "exile"] as const) {
        it(`strips them when the permanent goes to the ${zone}`, () => {
            const state = withCounteredBear();
            removePermanentTo(state, "bear", zone);
            const gone = findIn(state, zone)!;
            expect(gone).toBeDefined();
            expect(gone.counters).toBeUndefined();
            // CR 608.2h — the departure snapshot survives as LKI.
            expect(gone.countersAtLeave).toEqual({ "+1/+1": 2 });
        });
    }

    it("strips them on a bounce to hand too (no LKI needed there)", () => {
        const state = withCounteredBear();
        removePermanentTo(state, "bear", "hand");
        const back = findIn(state, "hand")!;
        expect(back.counters).toBeUndefined();
    });

    it("wire format: a dead permanent shows no counters client-side", () => {
        const state = withCounteredBear();
        removePermanentTo(state, "bear", "graveyard");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].graveyard.find(
            (c) => c.id === "bear"
        )!;
        expect(slim).toBeDefined();
        expect(slim.counters).toBeUndefined();
    });

    it("round-trips the LKI snapshot across the storage boundary", () => {
        const state = withCounteredBear();
        removePermanentTo(state, "bear", "graveyard");
        const round = expandState(compactState(state));
        const gone = round.players[0].graveyard.find((c) => c.id === "bear")!;
        expect(gone.counters).toBeUndefined();
        expect(gone.countersAtLeave).toEqual({ "+1/+1": 2 });
    });
});
