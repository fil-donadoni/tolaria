// CR 305.6 — a land with TWO OR MORE basic land types has one intrinsic
// "{T}: Add [mana symbol]" per type (issue #5623). The catalogue's typed duals
// and Triomes carry no printed mana ability: every reader must see every
// type, on every surface — the "could produce" read (CR 106.7) behind
// Fellwar Stone and the castability census, the Bot's payment planner, the
// game.ts tap primitive, and the client's tap-choice prompt through the wire
// projection.

import { describe, expect, it } from "vitest";
import {
    getBasicLandMana,
    getBasicLandManaColors,
    getManaTapOptions,
    getProducibleColors,
    hasBasicLandMana,
    manaGateBattlefields,
} from "../constants";
import { getProducibleManaOptions } from "../rules";
import { beginApplyingStaticEffects, type CardInstanceState } from "../state";
import { tapSourceIntoPayment } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    getManaChoices,
    hasIntrinsicLandMana,
    manaActivationRequiresTap,
} from "../../../src/lib/card-utils";
import type { CardInstance } from "../../../src/types/game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const BADLANDS = "717f6d10-9144-4ade-9ac6-a481cc66b875"; // Land — Swamp Mountain
const RAUGRIN_TRIOME = "02138fbb-3962-4348-8d31-faaefba0b8b2"; // Island Mountain Plains
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const URBORG = "19e1224f-82cb-4f41-8739-f880cba61bbb"; // each land is a Swamp
const FELLWAR_STONE = "dc47e322-f8b8-4685-b035-fda0cc433e6b";

describe("intrinsic mana of a land with two or more basic land types (CR 305.6)", () => {
    it("reads every basic land type, in printed order", () => {
        expect(getBasicLandManaColors(makeInstance(BADLANDS))).toEqual([
            "B",
            "R",
        ]);
        expect(getBasicLandManaColors(makeInstance(RAUGRIN_TRIOME))).toEqual([
            "U",
            "R",
            "W",
        ]);
    });

    it("has no single fixed colour — tapping it is a choice", () => {
        const badlands = makeInstance(BADLANDS);
        expect(getBasicLandMana(badlands)).toBeNull();
        expect(hasBasicLandMana(badlands)).toBe(true);
        expect(getManaTapOptions(badlands)).toEqual([{ B: 1 }, { R: 1 }]);
    });

    it("could produce every type's colour (CR 106.7)", () => {
        expect([...getProducibleColors(makeInstance(BADLANDS))]).toEqual([
            "B",
            "R",
        ]);
        expect([...getProducibleColors(makeInstance(RAUGRIN_TRIOME))]).toEqual([
            "U",
            "R",
            "W",
        ]);
    });

    it("a run-time second type is read too (Mountain under Urborg)", () => {
        const urborg = makeInstance(URBORG, {
            id: "urborg",
            controllerId: "p2",
        });
        const mountain = makeInstance(MOUNTAIN, {
            id: "m1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mountain] }),
                makePlayer("p2", { battlefield: [urborg] }),
            ],
        });
        beginApplyingStaticEffects(state, urborg);
        expect(getBasicLandMana(mountain)).toBeNull();
        expect([...getProducibleColors(mountain)]).toEqual(["R", "B"]);
    });

    it("Fellwar Stone reads both colours of an opponent's Badlands (CR 106.7)", () => {
        const stone = makeInstance(FELLWAR_STONE, {
            id: "stone",
            controllerId: "p1",
        });
        const badlands = makeInstance(BADLANDS, {
            id: "badlands",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [badlands] }),
            ],
        });
        expect(
            getManaTapOptions(stone, "p1", manaGateBattlefields(state))
        ).toEqual([{ B: 1 }, { R: 1 }]);
    });

    it("the Bot's payment planner indexes each colour", () => {
        const options = getProducibleManaOptions(makeInstance(BADLANDS));
        expect([...options.entries()]).toEqual([
            ["B", 0],
            ["R", 1],
        ]);
    });
});

describe("game.ts tap primitive on a typed dual (CR 305.6 / 605.3a)", () => {
    function payingState() {
        const badlands = makeInstance(BADLANDS, {
            id: "badlands",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [badlands] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        return { state, player: state.players[0], badlands };
    }

    it("taps for the second type's colour when its option is chosen", () => {
        const { state, player, badlands } = payingState();
        const tapped: string[] = [];
        tapSourceIntoPayment(state, player, badlands, 1, tapped);
        expect(badlands.isTapped).toBe(true);
        expect(player.manaPool.R).toBe(1);
        expect(player.manaPool.B ?? 0).toBe(0);
        expect(tapped).toEqual(["badlands"]);
    });

    it("demands a choice rather than tapping for the first type", () => {
        const { state, player, badlands } = payingState();
        expect(() =>
            tapSourceIntoPayment(state, player, badlands, undefined, [])
        ).toThrow(/choose/i);
        expect(badlands.isTapped).toBe(false);
    });
});

describe("client tap surface through the wire projection (CR 305.6)", () => {
    function slimBadlands(): { slim: CardInstance; players: CardInstance[][] } {
        const badlands = makeInstance(BADLANDS, {
            id: "badlands",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [badlands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "badlands"
        ) as unknown as CardInstance;
        return {
            slim,
            players: projected.players.map(
                (p) => p.battlefield as unknown as CardInstance[]
            ),
        };
    }

    it("is a tappable mana source paying {T} with no printed ability", () => {
        const { slim } = slimBadlands();
        expect(hasIntrinsicLandMana(slim)).toBe(true);
        expect(manaActivationRequiresTap(slim)).toBe(true);
    });

    it("prompts for {B} or {R}", () => {
        const { slim, players } = slimBadlands();
        expect(
            getManaChoices(slim, [
                { id: "p1", battlefield: players[0] },
                { id: "p2", battlefield: players[1] },
            ])
        ).toEqual([{ B: 1 }, { R: 1 }]);
    });

    it("keeps both subtypes on the slim instance", () => {
        const { slim } = slimBadlands();
        expect((slim as unknown as CardInstanceState).subtypes).toEqual([
            "Swamp",
            "Mountain",
        ]);
    });
});
