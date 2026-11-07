// CR 105.3 / 613.1e / 613.7 — a layer-5 colour SET from a static ability
// (`StaticColorSet`, `kind: "color-set"`, issue #2009): Shifting Sky's "All
// nonland permanents are the chosen color."
//
// The set is DERIVED OUTPUT (`colorSet`) written by `syncLayers2to5` and read
// through the one colour authority, `getEffectiveColors`, in place of the
// printed colours. These tests drive the real card, the real sync and the real
// projection.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import { getEffectiveColors } from "../../cards/effectiveColors";
import type { CardDefinition, PermanentView } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { forest } from "../../cards/sets/lea/colorless.cards";
import { shiftingSky } from "../../cards/sets/pls/blue.cards";
import { projectPublicState } from "../../gameProjections";
import { syncLayers2to5 } from "../layers2to5";
import type { GameState } from "../state";
import type { CardInstanceState } from "../state/declarations";

const GRANTER_ID = "test-2009-black-granter";

/** A permanent whose static ability makes every permanent black "in addition
 *  to its other colors" — the additive layer-5 sibling. */
function blackGranter(): CardDefinition {
    return {
        ...grizzlyBears(),
        id: GRANTER_ID,
        name: "Black Granter",
        staticEffects: [
            { kind: "color-grant", applies: () => true, colors: ["B"] },
        ],
    };
}

const colorsOf = (card: unknown) =>
    [...getEffectiveColors(card as PermanentView)].sort();

/** P1 controls Shifting Sky (chosen colour `chosen`, timestamp 10); P2 controls
 *  a green creature and a land. */
function board(chosen: string | null = "U") {
    const sky = makeInstance(shiftingSky().id, {
        id: "sky",
        controllerId: "p1",
        ownerId: "p1",
        staticSeq: 10,
        ...(chosen ? { chosenModeId: chosen } : {}),
    });
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
        staticSeq: 1,
    });
    const land = makeInstance(forest().id, {
        id: "land",
        controllerId: "p2",
        ownerId: "p2",
        staticSeq: 2,
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", { battlefield: [sky] }),
            makePlayer("p2", { battlefield: [bears, land] }),
        ],
    });
    return { state, sky, bears, land };
}

function granter(staticSeq: number): CardInstanceState {
    return makeInstance(GRANTER_ID, {
        id: "granter",
        controllerId: "p2",
        ownerId: "p2",
        staticSeq,
    });
}

describe("Shifting Sky — static colour SET (CR 105.3 / 613.1e)", () => {
    it("every nonland permanent becomes EXACTLY the chosen colour, its printed colour replaced (CR 105.3)", () => {
        const { state, sky, bears } = board("R");
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["R"]);
        // Shifting Sky is itself a nonland permanent.
        expect(colorsOf(sky)).toEqual(["R"]);
    });

    it("a land is left alone", () => {
        const { state, land } = board("R");
        syncLayers2to5(state);
        expect(colorsOf(land)).toEqual([]);
        expect(land.colorSet).toBeUndefined();
    });

    it("applies to a permanent that enters later (CR 611.3a)", () => {
        const { state } = board("B");
        syncLayers2to5(state);
        const late = makeInstance(grizzlyBears().id, {
            id: "late",
            controllerId: "p1",
            ownerId: "p1",
            staticSeq: 20,
        });
        state.players[0].battlefield.push(late);
        syncLayers2to5(state);
        expect(colorsOf(late)).toEqual(["B"]);
    });

    it("the printed colours come back when Shifting Sky leaves", () => {
        const { state, bears } = board("U");
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["U"]);
        state.players[0].battlefield = [];
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["G"]);
        expect(bears.colorSet).toBeUndefined();
    });

    it("no colour chosen sets nothing — never colourless", () => {
        const { state, bears } = board(null);
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["G"]);
    });

    it("a grant with an EARLIER timestamp is replaced by the set (CR 613.7)", () => {
        withTemporaryDefinition(blackGranter(), () => {
            const { state, bears } = board("U");
            state.players[1].battlefield.push(granter(5));
            syncLayers2to5(state);
            expect(colorsOf(bears)).toEqual(["U"]);
        });
    });

    it("a grant with a LATER timestamp adds on top of the set (CR 613.7)", () => {
        withTemporaryDefinition(blackGranter(), () => {
            const { state, bears } = board("U");
            state.players[1].battlefield.push(granter(15));
            syncLayers2to5(state);
            expect(colorsOf(bears)).toEqual(["B", "U"]);
        });
    });

    it("the set reaches the client through the projection (wire format)", () => {
        const { state, bears } = board("W");
        syncLayers2to5(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === bears.id
        )!;
        expect(colorsOf(slim)).toEqual(["W"]);
    });
});
