// Frontend wiring (SURFACE) test for a board-granted cast permission —
// Aluren, CR 601.3 / 118.9 (issue #2706).
//
// The client re-derives no cast timing at all (it reads the server-computed
// `legalActions`), but it DOES derive the cast-option list itself:
// `affordableAltCostsForCard` (src/lib/card-utils.ts) is the gate
// `useHandCardCommit` consults before opening the `AltCostPicker`. It now
// delegates to `castOptionAlternativeCosts`, which folds every board
// `cast-permission` static's free cast in beside the card's own alternative
// costs — so the picker offering the free cast depends on the OPPONENT's
// battlefield surviving the wire projection intact.
//
// That is exactly the drop this test exists to catch, so the assertion runs
// THROUGH `projectPublicState`, from the opponent's own viewer seat: p1 owns
// the Aluren, p2 holds the creature and is the one casting it ("Any player may
// cast…"). A hand-built view would mask a stripped battlefield field.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { aluren } from "@convex/cards/sets/tmp/green";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import { shivanDragon } from "@convex/cards/sets/lea/red";
import { projectPublicState } from "@convex/gameProjections";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const ALUREN_ALT_COST_ID = "cast-permission:any-player-creature-6221c861";

/** p1 controls Aluren; p2 holds `handCardId` and has priority during p1's
 *  turn — the off-window seat where the permission is the only thing that
 *  makes the cast possible at all. */
function projectedFor(handCardId: string) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(aluren.id, {
                        id: "aluren",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                hand: [
                    makeInstance(handCardId, {
                        id: "probe",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "hand",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p2",
    });
    const projected = projectPublicState(state, 1, "p2") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    const card = projected.players[1].hand.find(
        (c) => c?.id === "probe"
    ) as CardInstance;
    return { projected, card };
}

describe("affordableAltCostsForCard — board cast permission (CR 601.3 / 118.9)", () => {
    it("offers the opponent's Aluren free cast through the projected view", () => {
        const { projected, card } = projectedFor(grizzlyBears.id);

        const altIds = affordableAltCostsForCard(
            card,
            "p2",
            projected.players,
            projected.activePlayerId
        ).map((a) => a.id);

        expect(altIds).toContain(ALUREN_ALT_COST_ID);
    });

    it("offers nothing for a card the permission's filter excludes (CR 202.3 — mana value 6)", () => {
        const { projected, card } = projectedFor(shivanDragon.id);

        expect(
            affordableAltCostsForCard(
                card,
                "p2",
                projected.players,
                projected.activePlayerId
            )
        ).toEqual([]);
    });
});
