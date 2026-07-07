// Unified mana-tap options (CR 605.1a / 305.6). A permanent's tappable mana
// abilities form a SET: one intrinsic {T}: Add {C} per distinct basic land
// subtype, plus every printed/granted activated tap mana ability. A single {T}
// activates exactly one — the player chooses when 2+ survive. This is the
// regression suite for the class where a type-granting effect (Urborg, Tomb of
// Yawgmoth) collapsed multi-type lands to a single colour and hid a land's own
// activated ability (City of Traitors, Ancient Tomb).

import { describe, it, expect } from "vitest";
import { getManaTapOptions, getManaTapOptionsDetailed } from "../constants";
import { tapSourceIntoPayment } from "../../game";
import { applySourceStaticEffects, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { urborgTombOfYawgmoth } from "../../cards/sets/plc";
import { mountain, forest, tropicalIsland } from "../../cards/sets/lea";
import { cityOfTraitors } from "../../cards/sets/exo";
import { ancientTomb } from "../../cards/sets/tmp";

/** Puts Urborg on p1's battlefield and applies its Swamp-granting static to
 *  every land already there (CR 305.7 / 611, layer 4). */
function withUrborg(lands: ReturnType<typeof makeInstance>[]): {
    state: GameState;
    lands: ReturnType<typeof makeInstance>[];
} {
    const urborg = makeInstance(urborgTombOfYawgmoth.id, {
        id: "urborg-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const player = makePlayer("p1", { battlefield: [urborg, ...lands] });
    const state = makeState({ players: [player, makePlayer("p2")] });
    applySourceStaticEffects(state, urborg);
    return { state, lands };
}

const bf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

describe("getManaTapOptions — baseline (no type-granting effect)", () => {
    it("a basic Mountain exposes exactly {R}", () => {
        const m = makeInstance(mountain.id, { controllerId: "p1" });
        expect(getManaTapOptions(m)).toEqual([{ R: 1 }]);
    });

    it("City of Traitors exposes exactly {C}{C} from its own ability", () => {
        const c = makeInstance(cityOfTraitors.id, { controllerId: "p1" });
        expect(getManaTapOptions(c)).toEqual([{ C: 2 }]);
    });

    it("a dual land (Tropical Island) exposes {G} or {U}, no duplicate from its basic subtypes", () => {
        const d = makeInstance(tropicalIsland.id, { controllerId: "p1" });
        expect(getManaTapOptions(d)).toEqual([{ G: 1 }, { U: 1 }]);
    });
});

describe("getManaTapOptions — under Urborg (CR 305.6 stacks with own abilities)", () => {
    it("a Mountain can tap for {R} OR {B} (basic + granted Swamp)", () => {
        const m = makeInstance(mountain.id, {
            id: "mtn-1",
            controllerId: "p1",
        });
        const { state } = withUrborg([m]);
        expect(getManaTapOptions(m, "p1", bf(state))).toEqual([
            { R: 1 },
            { B: 1 },
        ]);
    });

    it("City of Traitors KEEPS {C}{C} and additionally offers {B}", () => {
        const c = makeInstance(cityOfTraitors.id, {
            id: "cot-1",
            controllerId: "p1",
        });
        const { state } = withUrborg([c]);
        expect(getManaTapOptions(c, "p1", bf(state))).toEqual([
            { C: 2 },
            { B: 1 },
        ]);
    });

    it("a dual land offers {U}, {G} AND {B}", () => {
        const d = makeInstance(tropicalIsland.id, {
            id: "dual-1",
            controllerId: "p1",
        });
        const { state } = withUrborg([d]);
        expect(getManaTapOptions(d, "p1", bf(state))).toEqual([
            { G: 1 },
            { U: 1 },
            { B: 1 },
        ]);
    });

    it("a real Swamp is not doubled — Urborg adds nothing new", () => {
        const f = makeInstance(forest.id, { id: "for-1", controllerId: "p1" });
        const { state } = withUrborg([f]);
        // Forest → {G}, plus granted Swamp → {B}. Two distinct options.
        expect(getManaTapOptions(f, "p1", bf(state))).toEqual([
            { G: 1 },
            { B: 1 },
        ]);
    });

    it("tags provenance: {C}{C} is activated, {B} is the intrinsic Swamp", () => {
        const c = makeInstance(cityOfTraitors.id, {
            id: "cot-2",
            controllerId: "p1",
        });
        const { state } = withUrborg([c]);
        const detailed = getManaTapOptionsDetailed(c, "p1", bf(state));
        expect(detailed[0].source).toMatchObject({ kind: "activated" });
        expect(detailed[1].source).toEqual({ kind: "basic", subtype: "Swamp" });
    });
});

describe("production path — tapSourceIntoPayment routes the chosen option (CR 605.1a)", () => {
    it("City of Traitors under Urborg: index 0 pays {C}{C}", () => {
        const c = makeInstance(cityOfTraitors.id, {
            id: "cot-3",
            controllerId: "p1",
        });
        const { state } = withUrborg([c]);
        const player = state.players[0];
        tapSourceIntoPayment(state, player, c, 0, []);
        expect(player.manaPool.C).toBe(2);
        expect(player.manaPool.B).toBe(0);
    });

    it("City of Traitors under Urborg: index 1 pays {B} (its own {C}{C} not forced)", () => {
        const c = makeInstance(cityOfTraitors.id, {
            id: "cot-4",
            controllerId: "p1",
        });
        const { state } = withUrborg([c]);
        const player = state.players[0];
        tapSourceIntoPayment(state, player, c, 1, []);
        expect(player.manaPool.B).toBe(1);
        expect(player.manaPool.C).toBe(0);
    });

    it("Mountain under Urborg: index 1 pays {B}", () => {
        const m = makeInstance(mountain.id, {
            id: "mtn-2",
            controllerId: "p1",
        });
        const { state } = withUrborg([m]);
        const player = state.players[0];
        tapSourceIntoPayment(state, player, m, 1, []);
        expect(player.manaPool.B).toBe(1);
        expect(player.manaPool.R).toBe(0);
    });
});

describe("riders fire per provenance (CR 605.1a / 120)", () => {
    it("Ancient Tomb under Urborg: tapping for {C}{C} deals 2 to controller", () => {
        const a = makeInstance(ancientTomb.id, {
            id: "at-1",
            controllerId: "p1",
        });
        const { state } = withUrborg([a]);
        const player = state.players[0];
        const before = player.life;
        tapSourceIntoPayment(state, player, a, 0, []);
        expect(player.manaPool.C).toBe(2);
        expect(player.life).toBe(before - 2);
    });

    it("Ancient Tomb under Urborg: tapping for {B} (the Swamp ability) deals NO damage", () => {
        const a = makeInstance(ancientTomb.id, {
            id: "at-2",
            controllerId: "p1",
        });
        const { state } = withUrborg([a]);
        const player = state.players[0];
        const before = player.life;
        tapSourceIntoPayment(state, player, a, 1, []);
        expect(player.manaPool.B).toBe(1);
        expect(player.life).toBe(before);
    });
});
