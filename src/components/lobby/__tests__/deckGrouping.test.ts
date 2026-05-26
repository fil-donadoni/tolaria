import { describe, it, expect } from "vitest";
import { groupDeckIntoPiles } from "../deckGrouping";

const LIGHTNING_BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
};
const SERRA_ANGEL = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
};
const SAVANNAH_LIONS = {
    cardId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0",
    cardName: "Savannah Lions",
};
const PLAINS = {
    cardId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    cardName: "Plains",
};
const MOX_PEARL = {
    cardId: "8ebe4be7-e12a-4596-a899-fbd5b152e879",
    cardName: "Mox Pearl",
};

describe("groupDeckIntoPiles", () => {
    it("returns empty array for empty deck", () => {
        expect(groupDeckIntoPiles([])).toEqual([]);
    });

    it("puts lands in the first pile", () => {
        const piles = groupDeckIntoPiles([PLAINS, LIGHTNING_BOLT, PLAINS]);
        expect(piles[0].key).toBe("lands");
        expect(piles[0].cards).toHaveLength(2);
    });

    it("only creates MV buckets that exist in the deck", () => {
        const piles = groupDeckIntoPiles([LIGHTNING_BOLT, SERRA_ANGEL]);
        const keys = piles.map((p) => p.key);
        expect(keys).toEqual(["mv-1", "mv-5"]);
    });

    it("sorts MV buckets ascending", () => {
        const piles = groupDeckIntoPiles([
            SERRA_ANGEL,
            LIGHTNING_BOLT,
            SAVANNAH_LIONS,
            MOX_PEARL,
        ]);
        expect(piles.map((p) => p.key)).toEqual(["mv-0", "mv-1", "mv-5"]);
    });

    it("groups duplicates within the same bucket adjacent", () => {
        const piles = groupDeckIntoPiles([
            LIGHTNING_BOLT,
            SAVANNAH_LIONS,
            LIGHTNING_BOLT,
        ]);
        const mv1 = piles.find((p) => p.key === "mv-1")!;
        expect(mv1.cards.map((c) => c.cardName)).toEqual([
            "Lightning Bolt",
            "Lightning Bolt",
            "Savannah Lions",
        ]);
    });

    it("handles a deck with only lands", () => {
        const piles = groupDeckIntoPiles([PLAINS, PLAINS, PLAINS]);
        expect(piles).toHaveLength(1);
        expect(piles[0].key).toBe("lands");
    });
});
