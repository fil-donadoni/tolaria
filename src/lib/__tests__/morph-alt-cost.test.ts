// Frontend wiring (SURFACE) test for the MORPH face-down cast option
// (CR 702.37a, issue #2705). Mirrors `bestow-alt-cost.test.ts`:
// `affordableAltCostsForCard` (src/lib/card-utils.ts) is the gate
// `useHandCardCommit` consults to decide whether to open the `AltCostPicker`,
// and it delegates to the server predicate `affordableAlternativeCosts`.
//
// Morph carries one thing no other cast option does, and it is the point of
// this file: the option is not a field on the card. `CardDefinition.morph`
// holds the printed TURN-UP cost, while the cast cost is the rule's flat {3}
// (CR 702.37a), synthesized server-side. A client that read the card's own
// `alternativeCosts[]` would offer nothing at all.
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
import { getCardByName } from "@convex/cards";
import { MORPH_CAST_ALT_COST_ID } from "@convex/gre/morph";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const ANGEL = getCardByName("Exalted Angel").id;
const PLAINS = getCardByName("Plains").id;

/** p1 holds Exalted Angel with `lands` untapped Plains. Returns the cast
 *  options the picker would offer, through the real projection. */
function offeredAltCosts(lands: number): { id: string; description: string }[] {
    const angel = makeInstance(ANGEL, {
        id: "angel",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [angel],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(PLAINS, {
                        id: `plains${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
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
        (c) => c?.id === "angel"
    ) as CardInstance;
    return affordableAltCostsForCard(
        card,
        "p1",
        projected.players,
        projected.activePlayerId
    );
}

describe("affordableAltCostsForCard — morph face-down cast option (CR 702.37a)", () => {
    it("offers the face-down cast through the projected view", () => {
        const offered = offeredAltCosts(3);
        expect(offered.map((a) => a.id)).toContain(MORPH_CAST_ALT_COST_ID);
    });

    it("labels it for a player who cannot see the card's rules text", () => {
        const morph = offeredAltCosts(3).find(
            (a) => a.id === MORPH_CAST_ALT_COST_ID
        )!;
        // CR 702.37c — what the player is choosing is the OBJECT, not just a
        // discount, so the label has to say what gets cast.
        expect(morph.description).toBe("Cast face down as a 2/2 creature");
    });

    it("offers nothing for a card with no morph and no alternative cost", () => {
        const bears = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bears] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1") as unknown as {
            players: Player[];
            activePlayerId: string;
        };
        const card = projected.players[0].hand.find(
            (c) => c?.id === "bear"
        ) as CardInstance;
        expect(
            affordableAltCostsForCard(
                card,
                "p1",
                projected.players,
                projected.activePlayerId
            )
        ).toEqual([]);
    });
});
