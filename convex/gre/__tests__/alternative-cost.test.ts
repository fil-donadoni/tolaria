// Cost-system tests for ALTERNATIVE casting costs (CR 118.9) — the
// return-N-lands / sacrifice-N-lands variants that replace a spell's mana
// cost. Exercises the pure helpers in `convex/gre/alternativeCost.ts`:
// affordability (`canPayAlternativeCost`) and the player-chosen give-up
// (`buildAlternativeCostChoice`), which routes through the unified
// permanent-cost choice layer (`sacrificeChoice.ts`) so WHICH permanents pay is
// the caster's explicit choice — never a silent first-N slice (#983 follow-up).
// See per-card behaviour in the mmq (Gush/Thwart) and vis (Fireblast) set tests.

import { describe, it, expect } from "vitest";
import type { AlternativeCost } from "../../cards/types";
import {
    canPayAlternativeCost,
    buildAlternativeCostChoice,
    matchingPermanentsForAltCost,
} from "../alternativeCost";
import {
    applySacrificeSelection,
    isSacrificeSelectionComplete,
} from "../sacrificeChoice";
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

describe("buildAlternativeCostChoice — forced/fungible auto-resolves (CR 118.9 / 701.21a)", () => {
    it("pre-fills the picks when the caster controls exactly the required count", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        // No real choice (2 Islands, must return 2) → auto-resolved + complete.
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        expect(sel.picked).toHaveLength(2);
        expect(sel.action).toBe("return");
    });

    it("auto-resolves indistinguishable extras (fungible basics)", () => {
        // Three untapped, counter-free, unenchanted Islands returning 2 are
        // indistinguishable — the choice is not meaningful, so it auto-resolves.
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 3) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        expect(sel.picked).toHaveLength(2);
    });
});

describe("buildAlternativeCostChoice — real choice parks (CR 118.9 / 701.21a)", () => {
    it("leaves the choice incomplete when a distinguishable extra exists", () => {
        // Three Mountains, one tapped → the two untapped and the tapped one are
        // NOT indistinguishable, so which two to sacrifice is a real choice.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ...mountainsFor("p1", 2),
                        makeInstance(mountain.id, {
                            id: "p1-mtn-tapped",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            sacrificeTwoMountains,
            "Fireblast"
        )!;
        // A real choice remains — no auto-pick; the caller parks the cast.
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
        expect(sel.picked).toHaveLength(0);
        expect(sel.action).toBe("sacrifice");
    });
});

describe("applySacrificeSelection — alternative-cost terminal actions (CR 118.9)", () => {
    it("returns the picked permanents to their owner's hand (return)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        applySacrificeSelection(state, sel);
        const p1 = state.players[0];
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.hand).toHaveLength(2);
        expect(p1.hand.every((c) => c.subtypes.includes("Island"))).toBe(true);
    });

    it("sacrifices the picked permanents to the graveyard (sacrifice)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mountainsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            sacrificeTwoMountains,
            "Fireblast"
        )!;
        applySacrificeSelection(state, sel);
        const p1 = state.players[0];
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.graveyard).toHaveLength(2);
    });
});
