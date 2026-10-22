// Echo arming (CR 702.30a, ADR 0155): "if this permanent came under your
// control since the beginning of your last upkeep" — `echoPending` is armed on
// EVERY arrival under a controller, not only a spell resolving. The two routes
// below are the ones the spell-resolution-only arming missed: a permanent put
// onto the battlefield by an effect, and one whose control changed.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards/index";
import { grizzlyBears, controlMagic } from "../../cards/sets/lea/index.cards";
import { applyControlChange, putHandCardOntoBattlefield } from "../state";

const GOBLIN_PATROL = getDefinition("d0fcd8d3-f159-49a1-8dd9-582ae4a0adc3");

describe("echoPending arming (CR 702.30a)", () => {
    it("arms on a battlefield entry that is not a cast (put from hand by an effect)", () => {
        const patrol = makeInstance(GOBLIN_PATROL.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [patrol] }), makePlayer("p2")],
        });
        expect(putHandCardOntoBattlefield(state, "p1", "patrol")).toBe(true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "patrol"
        );
        expect(live?.echoPending).toBe(true);
    });

    it("arms again on a control change, even after the echo was paid", () => {
        const patrol = makeInstance(GOBLIN_PATROL.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
        });
        patrol.enteredOnTurn = 1;
        // Echo already paid under p1: the flag is clear.
        delete patrol.echoPending;
        const magic = makeInstance(controlMagic().id, {
            id: "magic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            turn: 4,
            players: [
                makePlayer("p1", { battlefield: [patrol] }),
                makePlayer("p2", { battlefield: [magic] }),
            ],
        });
        applyControlChange(state, "patrol", "p2", "magic");
        const moved = state.players[1].battlefield.find(
            (c) => c.id === "patrol"
        );
        expect(moved?.echoPending).toBe(true);
    });

    it("never arms a permanent whose definition has no echo field", () => {
        const bears = makeInstance(grizzlyBears().id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        bears.enteredOnTurn = 1;
        const magic = makeInstance(controlMagic().id, {
            id: "magic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            turn: 4,
            players: [
                makePlayer("p1", { battlefield: [bears] }),
                makePlayer("p2", { battlefield: [magic] }),
            ],
        });
        applyControlChange(state, "bears", "p2", "magic");
        const moved = state.players[1].battlefield.find(
            (c) => c.id === "bears"
        );
        expect(moved?.echoPending).toBeUndefined();
    });
});
