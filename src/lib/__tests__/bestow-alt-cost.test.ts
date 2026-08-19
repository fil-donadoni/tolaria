// Frontend wiring (SURFACE) test for the Bestow cast-option affordance
// (CR 702.103, issue #2388). Mirrors `dash-alt-cost.test.ts` exactly:
// `affordableAltCostsForCard` (src/lib/card-utils.ts) is the gate
// `useHandCardCommit` consults to decide whether to open the `AltCostPicker`,
// and it delegates to the server predicate `affordableAlternativeCosts`,
// which now also folds in `CardDefinition.bestow` (mirroring `evoke`/`dash`).
//
// Bestow carries one gate the other two do not, and it is the point of this
// file: a bestowed cast is an AURA spell and needs a target (CR 601.2c /
// 702.103b), so the mode must NOT be offered on a board with no creature to
// enchant — clicking it would hard-reject at `announceCast` with no legal
// target and leave the player staring at a dead dialog.
//
// The assertion is driven THROUGH the wire reducer: state is projected via
// `projectPublicState` first, then the gate runs on the projected players. A
// hand-built view would mask a field the projection strips — the exact class
// of bug the frontend-wiring rule guards.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { springheartNantuko } from "@convex/cards/sets/mh3/green";
import { grizzlyBears } from "@convex/cards/sets/lea";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

/** p1 holds Springheart Nantuko; `hosts` decides whether any creature is on
 *  the battlefield to enchant. Returns the ids the picker would offer. */
function offeredAltCostIds(hosts: boolean): string[] {
    const nantuko = makeInstance(springheartNantuko.id, {
        id: "nantuko",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [nantuko],
                battlefield: hosts
                    ? [
                          makeInstance(grizzlyBears.id, {
                              id: "bear",
                              controllerId: "p1",
                          }),
                      ]
                    : [],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const projected = projectPublicState(state, 1, "p1") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    const card = projected.players[0].hand.find(
        (c) => c?.id === "nantuko"
    ) as CardInstance;
    return affordableAltCostsForCard(
        card,
        "p1",
        projected.players,
        projected.activePlayerId
    ).map((a) => a.id);
}

describe("affordableAltCostsForCard — Bestow cast-option gate (CR 702.103)", () => {
    it("offers the bestow variant through the projected view when a creature can host it", () => {
        expect(offeredAltCostIds(true)).toContain("bestow");
    });

    it("withholds it when no creature is on the battlefield (CR 601.2c — no legal target)", () => {
        expect(offeredAltCostIds(false)).not.toContain("bestow");
    });
});
