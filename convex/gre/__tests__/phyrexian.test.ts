// Phyrexian mana cost system (CR 107.4f) — the engine capability that backs the
// New Phyrexia cube cluster (issue #696). A `{C/P}` pip is paid with either one
// mana of the colour OR 2 life, the caster's per-pip choice. These tests cover
// the shared cost-system pieces (representation, colour identity, mana value,
// affordability solver, and the `getLegalActions` cast gate) once; the per-card
// behaviour (Dismember, Gitaxian Probe, Phyrexian Metamorph) lives in the nph
// per-colour test files.
import { describe, it, expect } from "vitest";
import { manaValue } from "../constants";
import { getColorsFromCost } from "../../cards/colors";
import {
    PHYREXIAN_LIFE_PER_PIP,
    phyrexianManaAdditions,
    phyrexianPipColors,
    phyrexianPipCount,
} from "../phyrexian";
import { getLegalActions, solvePhyrexianSplit } from "../rules";
import { dismember } from "../../cards/sets/nph/black";
import { gitaxianProbe, phyrexianMetamorph } from "../../cards/sets/nph/blue";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

describe("Phyrexian mana — representation (CR 107.4f / 202.3f)", () => {
    it("counts each Phyrexian pip as 1 toward mana value (CR 202.3f)", () => {
        // Dismember {1}{B/P}{B/P} = 3, Gitaxian Probe {U/P} = 1,
        // Phyrexian Metamorph {3}{U/P} = 4.
        expect(manaValue(dismember.manaCost)).toBe(3);
        expect(manaValue(gitaxianProbe.manaCost)).toBe(1);
        expect(manaValue(phyrexianMetamorph.manaCost)).toBe(4);
    });

    it("derives colour identity from Phyrexian pips (CR 105.2)", () => {
        // A card is the colour of its Phyrexian symbol even when castable for
        // life: Dismember is black, the two blue cards are blue.
        expect(getColorsFromCost(dismember.manaCost)).toEqual(["B"]);
        expect(getColorsFromCost(gitaxianProbe.manaCost)).toEqual(["U"]);
        expect(getColorsFromCost(phyrexianMetamorph.manaCost)).toEqual(["U"]);
    });

    it("expands pips and splits mana-paid additions", () => {
        expect(phyrexianPipCount(dismember.manaCost)).toBe(2);
        expect(phyrexianPipColors(dismember.manaCost)).toEqual(["B", "B"]);
        // Paying 1 of the 2 {B/P} with life leaves one {B} to fold into mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 1)).toEqual({ B: 1 });
        // Paying both with life folds no mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 2)).toEqual({});
        // Paying zero with life folds both pips into mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 0)).toEqual({ B: 2 });
        expect(PHYREXIAN_LIFE_PER_PIP).toBe(2);
    });
});

describe("Phyrexian mana — affordability split (CR 107.4f / 119.4)", () => {
    it("prefers the most-life split when the colour of mana is unavailable", () => {
        // Gitaxian Probe {U/P}, 20 life, no blue mana → pay the pip with 2 life.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 20 });
        const split = solvePhyrexianSplit(
            player,
            card,
            gitaxianProbe.manaCost!
        );
        expect(split).toEqual({ lifePips: 1, manaAdditions: {} });
    });

    it("falls back to mana when life can't cover the pip (CR 119.4)", () => {
        // Gitaxian Probe {U/P}, 1 life (can't pay 2), but {U} in the pool → the
        // pip is paid with mana, 0 life.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", {
            life: 1,
            manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        });
        const split = solvePhyrexianSplit(
            player,
            card,
            gitaxianProbe.manaCost!
        );
        expect(split).toEqual({ lifePips: 0, manaAdditions: { U: 1 } });
    });

    it("returns null when neither life nor mana can pay a pip", () => {
        // Gitaxian Probe {U/P}, 1 life, no blue mana → uncastable.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 1 });
        expect(
            solvePhyrexianSplit(player, card, gitaxianProbe.manaCost!)
        ).toBeNull();
    });

    it("still requires mana for the non-Phyrexian portion of the cost", () => {
        // Dismember {1}{B/P}{B/P}, 20 life, but NO mana at all → the {1} generic
        // can't be paid, so no split is affordable.
        const card = makeInstance(dismember.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 20 });
        expect(
            solvePhyrexianSplit(player, card, dismember.manaCost!)
        ).toBeNull();
    });

    it("mixes mana and life when neither pure split is affordable", () => {
        // Dismember {1}{B/P}{B/P}, 2 life (covers one pip), pool {C}{B}: pay {1}
        // with {C}, one {B/P} with {B}, the other {B/P} with 2 life.
        const card = makeInstance(dismember.id, { zone: "hand" });
        const player = makePlayer("p1", {
            life: 2,
            manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 },
        });
        const split = solvePhyrexianSplit(player, card, dismember.manaCost!);
        expect(split).toEqual({ lifePips: 1, manaAdditions: { B: 1 } });
    });
});

describe("Phyrexian mana — getLegalActions cast gate (CR 107.4f)", () => {
    function handState(cardId: string, life: number, manaPool = {}) {
        const card = makeInstance(cardId, { zone: "hand", controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life,
                    hand: [card],
                    manaPool: {
                        W: 0,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: 0,
                        ...manaPool,
                    },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, card };
    }

    it("offers 'cast' for a pure-Phyrexian cost when life covers it", () => {
        const { state, card } = handState(gitaxianProbe.id, 20);
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });

    it("hides 'cast' when neither life nor the colour of mana can pay", () => {
        const { state, card } = handState(gitaxianProbe.id, 1);
        expect(getLegalActions(state, state.players[0], card)).not.toContain(
            "cast"
        );
    });

    it("offers 'cast' at low life when the colour of mana is available", () => {
        const { state, card } = handState(gitaxianProbe.id, 1, { U: 1 });
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });
});
