// Cost-system tests for ALTERNATIVE casting costs (CR 118.9) — the
// return-N-lands / sacrifice-N-lands variants that replace a spell's mana
// cost. Exercises the pure helpers in `convex/gre/alternativeCost.ts`:
// affordability (`canPayAlternativeCost`) and payment (`payAlternativeCost`,
// return → owner's hand / sacrifice → graveyard). See per-card behaviour in
// the mmq (Gush/Thwart) and vis (Fireblast) set tests.

import { describe, it, expect } from "vitest";
import type { AlternativeCost } from "../../cards/types";
import {
    canPayAlternativeCost,
    payAlternativeCost,
    matchingPermanentsForAltCost,
} from "../alternativeCost";
import { island, mountain } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const returnTwoIslands: AlternativeCost = {
    id: "return-two-islands",
    description: "Return two Islands you control to their owner's hand",
    action: "return",
    count: 2,
    filter: { subtypes: "Island" },
};

const sacrificeTwoMountains: AlternativeCost = {
    id: "sacrifice-two-mountains",
    description: "Sacrifice two Mountains",
    action: "sacrifice",
    count: 2,
    filter: { subtypes: "Mountain" },
};

function islandsFor(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(island.id, {
            id: `${playerId}-island-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

function mountainsFor(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(mountain.id, {
            id: `${playerId}-mountain-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

describe("alternative cost — matching permanents (CR 118.9)", () => {
    it("counts only the caster's permanents matching the filter", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 3) }),
                // An opponent's Island must NOT count toward the caster's cost.
                makePlayer("p2", { battlefield: islandsFor("p2", 5) }),
            ],
        });
        const matches = matchingPermanentsForAltCost(
            state.players[0],
            returnTwoIslands
        );
        expect(matches).toHaveLength(3);
        expect(matches.every((c) => c.controllerId === "p1")).toBe(true);
    });
});

describe("canPayAlternativeCost (CR 118.9)", () => {
    it("is payable when the caster controls enough matching permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        expect(canPayAlternativeCost(state, "p1", returnTwoIslands)).toBe(true);
    });

    it("is NOT payable with too few matching permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 1) }),
                makePlayer("p2"),
            ],
        });
        expect(canPayAlternativeCost(state, "p1", returnTwoIslands)).toBe(
            false
        );
    });
});

describe("payAlternativeCost — return to hand (CR 701.24 / 118.9)", () => {
    it("returns exactly N Islands to their owner's hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 3) }),
                makePlayer("p2"),
            ],
        });
        payAlternativeCost(state, "p1", returnTwoIslands);
        const p1 = state.players[0];
        // Two Islands returned to hand, one still on the battlefield.
        expect(p1.battlefield).toHaveLength(1);
        expect(p1.hand).toHaveLength(2);
        expect(p1.hand.every((c) => c.subtypes.includes("Island"))).toBe(true);
    });
});

describe("payAlternativeCost — sacrifice (CR 701.16 / 118.9)", () => {
    it("sacrifices exactly N Mountains to the graveyard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mountainsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        payAlternativeCost(state, "p1", sacrificeTwoMountains);
        const p1 = state.players[0];
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.graveyard).toHaveLength(2);
    });
});

describe("payAlternativeCost — unaffordable (CR 118.9)", () => {
    it("throws when the caster no longer controls enough permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 1) }),
                makePlayer("p2"),
            ],
        });
        expect(() =>
            payAlternativeCost(state, "p1", returnTwoIslands)
        ).toThrow();
    });
});
