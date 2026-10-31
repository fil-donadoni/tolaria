// Frontend wiring (SURFACE) test for the Impending cast option (CR 702.176a,
// issue #1970). Mirrors `dash-alt-cost.test.ts`: `affordableAltCostsForCard`
// (src/lib/card-utils.ts) is the gate `useHandCardCommit` consults to open the
// `AltCostPicker`, and it delegates to the server's
// `affordableAlternativeCosts`, which folds in `CardDefinition.impending`.
//
// Driven THROUGH the wire reducer — `projectPublicState` first, then the gate
// on the projected players — so a field the projection strips cannot hide
// behind a hand-built view. The second half reads the battlefield the same
// way: an impending permanent reaches the client as a noncreature
// Enchantment carrying its time counters.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { overlordOfTheBalemurk } from "@convex/cards/sets/dsk/black.cards";
import { syncLayers2to5 } from "@convex/gre/layers2to5";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

type Projected = { players: Player[]; activePlayerId: string };

describe("affordableAltCostsForCard — Impending cast option (CR 702.176a)", () => {
    it("offers the impending cost for Overlord of the Balemurk in hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(overlordOfTheBalemurk().id, {
                            id: "overlord",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as Projected;
        const card = projected.players[0].hand.find(
            (c) => c?.id === "overlord"
        ) as CardInstance;
        expect(
            affordableAltCostsForCard(
                card,
                "p1",
                projected.players,
                projected.activePlayerId
            ).map((a) => a.id)
        ).toContain("impending");
    });

    it("projects an impending Overlord as a noncreature Enchantment with its time counters", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(overlordOfTheBalemurk().id, {
                            id: "overlord",
                            controllerId: "p1",
                            ownerId: "p1",
                            impended: true,
                            counters: { time: 3 },
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        syncLayers2to5(state);
        const projected = projectPublicState(
            state,
            1,
            "p2"
        ) as unknown as Projected;
        const wire = projected.players[0].battlefield.find(
            (c) => c.id === "overlord"
        )!;
        expect(wire.types).toEqual(["Enchantment"]);
        expect(wire.counters?.time).toBe(3);
    });
});
