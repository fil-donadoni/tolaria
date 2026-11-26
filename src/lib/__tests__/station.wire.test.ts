// Frontend wiring for Station (CR 702.184) and station symbols (CR 721.2) —
// issue #10528.
//
// Full path GRE → wire → client: the board is projected by the REAL
// `projectPublicState`, and the client reads it through its own helpers —
// `effectivePower` / `effectiveToughness` for the CR 721.2b P/T box and
// `getStackAbilities` for the activation affordance (the station ability, and
// a striation's ability only at N+ charge counters, CR 721.2a).

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { CHARGE_COUNTER } from "@convex/cards/abilities/station";
import { BEAR_ID, SPACECRAFT_ID } from "@convex/cards/__tests__/station.helper";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { CardInstance } from "~/types/game";
import { effectivePower, effectiveToughness } from "../effective-stats";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

function wireBoard(charge: number) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SPACECRAFT_ID, {
                        id: "ship",
                        controllerId: "p1",
                        ownerId: "p1",
                        staticSeq: 1,
                        counters: { [CHARGE_COUNTER]: charge },
                    }),
                    makeInstance(BEAR_ID, {
                        id: "bear",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    const battlefield = wire.players[0]!
        .battlefield as unknown as CardInstance[];
    const ship = battlefield.find((c) => c.id === "ship")!;
    return { wire, battlefield, ship };
}

function offered(charge: number): string[] {
    const { wire, battlefield, ship } = wireBoard(charge);
    const view = buildTriggerStateView(
        [
            { id: "p1", life: 20, hand: [], battlefield, graveyard: [] },
            { id: "p2", life: 20, hand: [], battlefield: [], graveyard: [] },
        ],
        "p1",
        undefined,
        undefined,
        undefined,
        undefined,
        wire.emblems
    );
    return getStackAbilities(ship, "PRECOMBAT_MAIN", true, view, 20).map(
        (a) => a.id
    );
}

describe("Station on the client (CR 702.184 / 721.2)", () => {
    it("reads the P/T box's base power and toughness at N+ (CR 721.2b)", () => {
        const { wire, ship } = wireBoard(5);
        const players = wire.players as unknown as Parameters<
            typeof effectivePower
        >[0];
        expect(ship.types).toContain("Creature");
        expect(
            effectivePower(players, ship, wire.emblems, wire.continuousEffects)
        ).toBe(6);
        expect(
            effectiveToughness(
                players,
                ship,
                wire.emblems,
                wire.continuousEffects
            )
        ).toBe(6);
    });

    it("offers the station ability at any charge (CR 721.4)", () => {
        expect(offered(0)).toContain("station");
        expect(offered(9)).toContain("station");
    });

    it("offers a striation's activated ability only at N+ (CR 721.2a)", () => {
        expect(offered(1)).not.toContain("test-station-draw");
        expect(offered(2)).toContain("test-station-draw");
    });
});
