import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    isManaCostCovered,
    normalizeManaCost,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets } from "../../../../gre/rules";
import { figureOfFable } from "../multicolor";

// Figure of Fable (ECL, issue #684 — shipped by #1749). Same staged-respec
// shape as Figure of Destiny (eve/multicolor.ts), plus two things that card
// doesn't exercise: a MIXED cost (generic + hybrid pips) and the CR 702.16j
// player-quality protection its final stage grants (issue #1748).

const FABLE_ID = "e0ef33dd-5f6d-48fa-8ef6-a8092868d50f";

function setup() {
    const fable = makeInstance(FABLE_ID, {
        id: "fable",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [fable] }), makePlayer("p2")],
    });
    return { state, fable };
}

function fire(state: GameState, source: CardInstanceState, abilityId: string) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

function live(state: GameState): CardInstanceState {
    return state.players[0].battlefield.find((c) => c.id === "fable")!;
}

/** Walk the whole chain: Kithkin → Scout → Soldier → Avatar. */
function toAvatar(state: GameState, fable: CardInstanceState) {
    fire(state, fable, "figure-of-fable-scout");
    fire(state, live(state), "figure-of-fable-soldier");
    fire(state, live(state), "figure-of-fable-avatar");
}

describe("Figure of Fable — costs (CR 202.1a)", () => {
    it("mixes generic mana with guild-hybrid pips", () => {
        const [scout, soldier, avatar] = figureOfFable.activatedAbilities!;
        expect(normalizeManaCost(figureOfFable.manaCost!)).toEqual({
            "G/W": 1,
        });
        expect(normalizeManaCost(scout.cost.mana!)).toEqual({ "G/W": 1 });
        expect(normalizeManaCost(soldier.cost.mana!)).toEqual({
            X: 1,
            "G/W": 2,
        });
        expect(normalizeManaCost(avatar.cost.mana!)).toEqual({
            X: 3,
            "G/W": 3,
        });
    });

    it("pays the pips from either colour, the generic from anything", () => {
        const cost = normalizeManaCost(
            figureOfFable.activatedAbilities![1].cost.mana!
        );
        expect(isManaCostCovered({ G: 2, R: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 1, G: 1, R: 1 }, cost)).toBe(true);
        // Two generic-only mana can't stand in for a hybrid pip.
        expect(isManaCostCovered({ R: 3 }, cost)).toBe(false);
    });
});

describe("Figure of Fable — staged respec REPLACES the type line (CR 205.1b)", () => {
    it("stops being a Scout once it becomes a Soldier", () => {
        const { state, fable } = setup();
        fire(state, fable, "figure-of-fable-scout");
        expect(live(state).subtypes).toEqual(["Kithkin", "Scout"]);
        fire(state, live(state), "figure-of-fable-soldier");
        const soldier = live(state);
        expect(soldier.subtypes).toEqual(["Kithkin", "Soldier"]);
        expect(soldier.subtypes).not.toContain("Scout");
        expect(getEffectivePower(state, soldier)).toBe(4);
        expect(getEffectiveToughness(state, soldier)).toBe(5);
    });

    it("re-activating the Soldier stage is a no-op once it isn't a Scout", () => {
        // The direct consequence of REPLACE-not-ADD: the gate closes behind it.
        const { state, fable } = setup();
        fire(state, fable, "figure-of-fable-scout");
        fire(state, live(state), "figure-of-fable-soldier");
        fire(state, live(state), "figure-of-fable-soldier");
        expect(live(state).subtypes).toEqual(["Kithkin", "Soldier"]);
    });

    it("reaches the 7/8 Avatar through the full chain", () => {
        const { state, fable } = setup();
        toAvatar(state, fable);
        const avatar = live(state);
        expect(avatar.subtypes).toEqual(["Kithkin", "Avatar"]);
        expect(getEffectivePower(state, avatar)).toBe(7);
        expect(getEffectiveToughness(state, avatar)).toBe(8);
    });
});

describe("Figure of Fable — protection from each opponent (CR 702.16j)", () => {
    it("is untargetable by an opponent but not by its controller", () => {
        const { state, fable } = setup();
        toAvatar(state, fable);
        const requirement = { type: "Creature" as const, count: 1 };
        const forOpponent = getLegalTargets(state, requirement, ["R"], "p2");
        expect(forOpponent.some((t) => t.id === "fable")).toBe(false);
        const forController = getLegalTargets(state, requirement, ["R"], "p1");
        expect(forController.some((t) => t.id === "fable")).toBe(true);
    });

    it("has no protection before the final stage resolves", () => {
        const { state, fable } = setup();
        fire(state, fable, "figure-of-fable-scout");
        const requirement = { type: "Creature" as const, count: 1 };
        const forOpponent = getLegalTargets(state, requirement, ["R"], "p2");
        expect(forOpponent.some((t) => t.id === "fable")).toBe(true);
    });
});
