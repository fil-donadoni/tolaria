import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import { orderLibrarySearchCards } from "../library-search-order";

// Follow-up to issue #933: the search-library pick pile puts eligible
// (allow-listed) cards first, then sorts the whole pile by type line with card
// name as the tiebreaker. Type/name resolve from the card registry — the wire
// projection strips `card.card` to `{ id }`, so the helper looks them up.

/** A face-up search-pile instance whose def id is the named card's, so the
 *  helper resolves its real type/name. `instanceId` keeps eligibility distinct
 *  from the def id (an allow-list keys on the instance id). */
function pileCard(name: string, instanceId: string): CardInstance {
    return {
        id: instanceId,
        card: { id: getCardByName(name).id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
}

const names = (cards: CardInstance[], byName: Record<string, string>) =>
    cards.map((c) => byName[c.id]);

describe("orderLibrarySearchCards", () => {
    it("sorts by type line then name when unfiltered (no eligibleIds)", () => {
        const byName: Record<string, string> = {
            i1: "Grizzly Bears", // Creature
            i2: "Black Lotus", // Artifact
            i3: "Savannah Lions", // Creature
            i4: "Bayou", // Land
        };
        const cards = Object.entries(byName).map(([id, n]) => pileCard(n, id));
        const out = orderLibrarySearchCards(cards);
        // Artifact < Creature < Land; within Creature, Grizzly < Savannah.
        expect(names(out, byName)).toEqual([
            "Black Lotus",
            "Grizzly Bears",
            "Savannah Lions",
            "Bayou",
        ]);
    });

    it("puts eligible cards first, each bucket sorted by type then name", () => {
        const byName: Record<string, string> = {
            i1: "Black Lotus", // Artifact — ineligible
            i2: "Savannah Lions", // Creature — eligible
            i3: "Bayou", // Land — ineligible
            i4: "Grizzly Bears", // Creature — eligible
        };
        const cards = Object.entries(byName).map(([id, n]) => pileCard(n, id));
        const eligible = new Set(["i2", "i4"]);
        const out = orderLibrarySearchCards(cards, eligible);
        // Eligible bucket first (Grizzly < Savannah), then ineligible
        // (Artifact < Land).
        expect(names(out, byName)).toEqual([
            "Grizzly Bears",
            "Savannah Lions",
            "Black Lotus",
            "Bayou",
        ]);
    });

    it("does not mutate the input array", () => {
        const cards = [pileCard("Bayou", "i1"), pileCard("Black Lotus", "i2")];
        const before = cards.map((c) => c.id);
        orderLibrarySearchCards(cards);
        expect(cards.map((c) => c.id)).toEqual(before);
    });
});
