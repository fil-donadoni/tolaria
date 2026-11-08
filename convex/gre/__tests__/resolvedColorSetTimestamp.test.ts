// CR 613.7 / 613.7b — the colour SET a resolving spell or ability leaves behind
// (`colorOverride`, written by `applyColorOverrideToPermanent`: the `setColor`
// Op, lace instants, `animateAsCreature`'s `colors`) carries the timestamp it
// was created at, and takes part in the layer-5 walk (`gre/layers2to5.ts`) like
// every static `color-set` / `color-grant`. "An effect with an earlier
// timestamp is applied before an effect with a later timestamp."
//
// Drives the real primitive, the real timestamp allocator, the real sync, the
// real cleanup boundary and the real projection.

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
import { shiftingSky } from "../../cards/sets/pls/blue.cards";
import { projectPublicState } from "../../gameProjections";
import { syncLayers2to5 } from "../layers2to5";
import { finalizeCleanup } from "../phases";
import {
    allocStaticTimestamp,
    applyColorOverrideToPermanent,
    type GameState,
} from "../state";
import type { CardInstanceState } from "../state/declarations";

const GRANTER_ID = "test-8812-red-granter";

/** "All permanents are red in addition to their other colors" — the additive
 *  layer-5 sibling (Painter's Servant's shape on the battlefield). */
function redGranter(): CardDefinition {
    return {
        ...grizzlyBears(),
        id: GRANTER_ID,
        name: "Red Granter",
        staticEffects: [
            { kind: "color-grant", applies: () => true, colors: ["R"] },
        ],
    };
}

const colorsOf = (card: unknown) =>
    [...getEffectiveColors(card as PermanentView)].sort();

/** P2 controls a green creature; P1's battlefield is empty. */
function board(): { state: GameState; bears: CardInstanceState } {
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
        staticSeq: 1,
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [bears] })],
        activePlayerId: "p1",
    });
    return { state, bears };
}

/** A static source entering NOW: stamped with the next timestamp. */
function enter(state: GameState, card: CardInstanceState): void {
    card.staticSeq = allocStaticTimestamp(state);
    state.players[0].battlefield.push(card);
    syncLayers2to5(state);
}

function sky(chosen: string): CardInstanceState {
    return makeInstance(shiftingSky().id, {
        id: "sky",
        controllerId: "p1",
        ownerId: "p1",
        chosenModeId: chosen,
    });
}

function granter(): CardInstanceState {
    return makeInstance(GRANTER_ID, {
        id: "granter",
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** "Target permanent becomes white" (Purelace) resolving NOW. */
function lace(
    state: GameState,
    card: CardInstanceState,
    colors: ("W" | "U" | "B" | "R" | "G")[],
    duration?: { phase: "end-of-turn" }
): void {
    applyColorOverrideToPermanent(
        card,
        colors,
        duration,
        allocStaticTimestamp(state)
    );
}

/** CR 514.2 — the cleanup step's "until end of turn" boundary. */
function cleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
    state.turn += 1;
    state.phase = "PRECOMBAT_MAIN";
}

function slim(state: GameState, id: string): unknown {
    return projectPublicState(state, 1, "p1").players[1].battlefield.find(
        (c) => c.id === id
    );
}

describe("a resolved colour SET is timestamped (CR 613.7 / 613.7b)", () => {
    it("a static colour set that arrives LATER replaces it (CR 105.3)", () => {
        const { state, bears } = board();
        lace(state, bears, ["W"]);
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["W"]);
        enter(state, sky("U"));
        expect(colorsOf(bears)).toEqual(["U"]);
        expect(colorsOf(slim(state, bears.id))).toEqual(["U"]);
    });

    it("a colour grant that arrives LATER adds on top of it", () => {
        withTemporaryDefinition(redGranter(), () => {
            const { state, bears } = board();
            lace(state, bears, ["W"]);
            enter(state, granter());
            expect(colorsOf(bears)).toEqual(["R", "W"]);
            expect(colorsOf(slim(state, bears.id))).toEqual(["R", "W"]);
        });
    });

    it("a colour grant from EARLIER is replaced by it", () => {
        withTemporaryDefinition(redGranter(), () => {
            const { state, bears } = board();
            enter(state, granter());
            expect(colorsOf(bears)).toEqual(["G", "R"]);
            lace(state, bears, ["W"]);
            expect(colorsOf(bears)).toEqual(["W"]);
            syncLayers2to5(state);
            expect(colorsOf(bears)).toEqual(["W"]);
            expect(colorsOf(slim(state, bears.id))).toEqual(["W"]);
        });
    });

    it("it replaces a static colour set from EARLIER, before and after the sync", () => {
        const { state, bears } = board();
        enter(state, sky("U"));
        expect(colorsOf(bears)).toEqual(["U"]);
        lace(state, bears, ["W"]);
        expect(colorsOf(bears)).toEqual(["W"]);
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["W"]);
        expect(colorsOf(slim(state, bears.id))).toEqual(["W"]);
    });

    it("a timed set ends at its own boundary and the LATER static set shows through, not the older indefinite one", () => {
        const { state, bears } = board();
        lace(state, bears, ["W"]);
        enter(state, sky("U"));
        lace(state, bears, ["B"], { phase: "end-of-turn" });
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["B"]);
        cleanup(state);
        expect(bears.colorOverride).toEqual(["W"]);
        expect(colorsOf(bears)).toEqual(["U"]);
        expect(colorsOf(slim(state, bears.id))).toEqual(["U"]);
    });

    it("a timed set over an EARLIER static set ends and the static set comes back", () => {
        const { state, bears } = board();
        enter(state, sky("U"));
        lace(state, bears, ["B"], { phase: "end-of-turn" });
        syncLayers2to5(state);
        expect(colorsOf(bears)).toEqual(["B"]);
        cleanup(state);
        expect(bears.colorOverride).toBeUndefined();
        expect(colorsOf(bears)).toEqual(["U"]);
    });
});
