// Frontend wiring (SURFACE) test for the Adventure cast option (CR 715.3,
// ADR 0120). Same shape as its siblings `morph-alt-cost.test.ts` and
// `bestow-alt-cost.test.ts`.
//
// `affordableAltCostsForCard` (`src/lib/card-utils.ts`) is the gate
// `useHandCardCommit` consults to decide whether to open the `AltCostPicker`,
// and it delegates to the server authority `castOptionAlternativeCosts`.
//
// What Adventure carries that no other cast option does is that the option
// names a DIFFERENT SPELL. The picker row is the only place the player is told
// which half they are casting, and its label comes from
// `AlternativeCost.description` — a server-computed field the client renders
// verbatim (`alt-cost-picker.tsx`). A row reading "Cast Brazen Borrower" — or
// no row at all, because the client read the card's own `alternativeCosts[]`,
// which is empty — is the whole failure mode: the Adventure would be
// unreachable for a human while every server-side test stayed green.
//
// The assertion is driven THROUGH the wire reducer: state is projected via
// `projectPublicState` first, then the gate runs on the projected players. A
// hand-built view would mask a field the projection strips.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { ADVENTURE_CAST_ALT_COST_PREFIX } from "@convex/gre/adventure";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const BORROWER = getCardByName("Brazen Borrower").id;
const ISLAND = getCardByName("Island").id;

/** p1 holds Brazen Borrower with `lands` untapped Islands. Returns the cast
 *  options the picker would offer, through the real projection. */
function offeredAltCosts(lands: number): { id: string; description: string }[] {
    const borrower = makeInstance(BORROWER, {
        id: "borrower",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [borrower],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `island${i}`,
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
        (c) => c?.id === "borrower"
    ) as CardInstance;
    return affordableAltCostsForCard(
        card,
        "p1",
        projected.players,
        projected.activePlayerId
    );
}

const adventureRow = (
    offered: { id: string; description: string }[]
): { id: string; description: string } | undefined =>
    offered.find((a) => a.id.startsWith(ADVENTURE_CAST_ALT_COST_PREFIX));

describe("affordableAltCostsForCard — the Adventure cast option (CR 715.3)", () => {
    it("offers the Adventure through the projected view", () => {
        expect(adventureRow(offeredAltCosts(2))).toBeDefined();
    });

    it("labels the row with the HALF being cast, not the card", () => {
        // CR 715.3 — "the player chooses whether they play the card normally or
        // as an Adventure." A row that named Brazen Borrower would describe the
        // choice the player is NOT making.
        const row = adventureRow(offeredAltCosts(2))!;
        expect(row.description).toContain("Petty Theft");
        expect(row.description).toContain("Return target nonland permanent");
    });

    it("offers nothing for a card with no inset spell", () => {
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
