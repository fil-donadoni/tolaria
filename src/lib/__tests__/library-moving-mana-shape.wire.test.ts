// Frontend wiring for a mana-shaped ability that is NOT a mana ability (CR
// 605.1a: "its cost and effect don't move any card to or from a library").
// Chromatic Sphere's "{1}, {T}, Sacrifice this artifact: Add one mana of any
// color. Draw a card." draws, so it uses the stack: the client must offer it
// through the ordinary activated-ability menu and never as a tap-for-mana
// source. The board crosses the real projection and the real reducer.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance, Player } from "~/types/game";
import {
    buildTriggerStateView,
    getActivatedManaMenuEntry,
    getStackAbilities,
    hasManaAbility,
} from "../card-utils";

function onWire() {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(getCardByName("Chromatic Sphere").id, {
                        id: "sphere",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const sphere = players
        .find((p) => p.id === "p1")!
        .battlefield.find((c) => c.id === "sphere") as CardInstance;
    return { view, sphere };
}

describe("a mana-shaped ability that draws is a stack ability on the wire (CR 605.1a)", () => {
    it("is offered through the activated-ability menu", () => {
        const { view, sphere } = onWire();
        expect(
            getStackAbilities(sphere, "PRECOMBAT_MAIN", true, view, 20).map(
                (a) => a.id
            )
        ).toEqual(["chromatic-sphere-mana"]);
    });

    it("is not a tap-for-mana source", () => {
        const { view, sphere } = onWire();
        expect(hasManaAbility(sphere, view)).toBe(false);
        expect(getActivatedManaMenuEntry(sphere, view)).toBeNull();
    });
});
