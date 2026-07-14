import { describe, it, expect } from "vitest";
import { groupPoolCards } from "../limitedPoolGrouping";

describe("groupPoolCards (PRD #1107, ADR 0054/0055)", () => {
    it("groups duplicate cards by canonical Card ID into a count", () => {
        const grouped = groupPoolCards([
            { scryfallId: "s1", cardId: "bolt", cardName: "Lightning Bolt" },
            { scryfallId: "s2", cardId: "bolt", cardName: "Lightning Bolt" },
            { scryfallId: "s3", cardId: "shock", cardName: "Shock" },
        ]);
        expect(grouped).toEqual([
            { cardId: "bolt", cardName: "Lightning Bolt", count: 2 },
            { cardId: "shock", cardName: "Shock", count: 1 },
        ]);
    });

    it("sorts groups alphabetically by card name", () => {
        const grouped = groupPoolCards([
            { scryfallId: "s1", cardId: "z", cardName: "Zombie" },
            { scryfallId: "s2", cardId: "a", cardName: "Angel" },
        ]);
        expect(grouped.map((c) => c.cardName)).toEqual(["Angel", "Zombie"]);
    });

    it("returns an empty list for an empty pool", () => {
        expect(groupPoolCards([])).toEqual([]);
    });

    it("keeps two different printings of the same canonical card as one group", () => {
        // Two Alpha art variants of a basic land both resolve to the same
        // canonical cardId — the display should still show one grouped entry.
        const grouped = groupPoolCards([
            { scryfallId: "art1", cardId: "mountain", cardName: "Mountain" },
            { scryfallId: "art2", cardId: "mountain", cardName: "Mountain" },
        ]);
        expect(grouped).toEqual([
            { cardId: "mountain", cardName: "Mountain", count: 2 },
        ]);
    });
});
