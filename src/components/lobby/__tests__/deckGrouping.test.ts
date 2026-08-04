import { describe, it, expect } from "vitest";
import { groupDeckIntoFixedColumns, groupDeckIntoPiles } from "../deckGrouping";
import { makeDeckCardShapeResolver } from "~/lib/deckCardShape";

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

// A Tabletop (`manual`) deck's pool is the whole Full Catalogue (ADR 0080), so
// its cards are NOT guaranteed to be in the card registry — grouping them must
// not throw `Card not found`, and must still bucket them correctly off the
// catalogue row.
describe("groupDeckIntoPiles — catalogue-only cards (Tabletop, ADR 0080)", () => {
    const UNIMPLEMENTED_CREATURE = {
        cardId: "0d16e8e0-31b2-4389-afd6-783c501f6fa0",
        cardName: "Unimplemented Creature",
    };
    const UNIMPLEMENTED_LAND = {
        cardId: "11111111-2222-3333-4444-555555555555",
        cardName: "Unimplemented Land",
    };

    const catalogueResolver = makeDeckCardShapeResolver([
        {
            name: UNIMPLEMENTED_CREATURE.cardName,
            printId: UNIMPLEMENTED_CREATURE.cardId,
            typeLine: "Legendary Creature — Elder Dragon",
            manaCost: "{3}{U}{B}{R}",
            cmc: 6,
            colourIdentity: "UBR",
            set: "leg",
            rarity: "rare",
            nameFold: "unimplemented creature",
            available: false,
        },
        {
            name: UNIMPLEMENTED_LAND.cardName,
            printId: UNIMPLEMENTED_LAND.cardId,
            typeLine: "Land — Desert",
            manaCost: "",
            cmc: 0,
            colourIdentity: "",
            set: "arn",
            rarity: "uncommon",
            nameFold: "unimplemented land",
            available: false,
        },
    ]);

    it("does not throw on a card the registry has never heard of", () => {
        expect(() =>
            groupDeckIntoPiles([UNIMPLEMENTED_CREATURE])
        ).not.toThrow();
    });

    it("buckets a catalogue-only card by its printed mana value", () => {
        const piles = groupDeckIntoPiles(
            [LIGHTNING_BOLT, UNIMPLEMENTED_CREATURE],
            catalogueResolver
        );
        expect(piles.map((p) => p.key)).toEqual(["mv-1", "mv-6"]);
        expect(piles[1].cards.map((c) => c.cardName)).toEqual([
            "Unimplemented Creature",
        ]);
    });

    it("puts a catalogue-only land in the Lands pile", () => {
        const piles = groupDeckIntoPiles(
            [UNIMPLEMENTED_LAND, LIGHTNING_BOLT],
            catalogueResolver
        );
        expect(piles[0].key).toBe("lands");
        expect(piles[0].cards.map((c) => c.cardName)).toEqual([
            "Unimplemented Land",
        ]);
    });

    it("collects cards nothing can describe into a trailing Unknown pile", () => {
        // No catalogue loaded yet: the registry can't resolve it either.
        const piles = groupDeckIntoPiles([LIGHTNING_BOLT, UNIMPLEMENTED_LAND]);
        expect(piles.map((p) => p.key)).toEqual(["mv-1", "unknown"]);
        expect(piles[1].cards.map((c) => c.cardName)).toEqual([
            "Unimplemented Land",
        ]);
    });
});

// The limited deckbuilder's fixed-column grouping (issue #1575) — parity with
// the draft Pool: every column always present (a stable drop target even when
// empty), a card's column honouring a manual per-card override.
const NONE = () => undefined;

describe("groupDeckIntoFixedColumns (issue #1575)", () => {
    it("always renders the full fixed column set (Lands + MV 0..7), even for an empty deck", () => {
        const columns = groupDeckIntoFixedColumns([], NONE);
        expect(columns.map((c) => c.key)).toEqual([
            "lands",
            "mv-0",
            "mv-1",
            "mv-2",
            "mv-3",
            "mv-4",
            "mv-5",
            "mv-6",
            "mv-7",
        ]);
        expect(columns.every((c) => c.cards.length === 0)).toBe(true);
    });

    it("labels the top column MV 7+ and exposes each column's drop identity", () => {
        const columns = groupDeckIntoFixedColumns([], NONE);
        expect(columns.find((c) => c.column === 7)!.label).toBe("MV 7+");
        expect(columns.find((c) => c.column === "lands")!.label).toBe("Lands");
    });

    it("buckets each card by its auto column when there's no override", () => {
        const columns = groupDeckIntoFixedColumns(
            [LIGHTNING_BOLT, SERRA_ANGEL, PLAINS, MOX_PEARL],
            NONE
        );
        const at = (col: number | "lands") =>
            columns.find((c) => c.column === col)!.cards.map((c) => c.cardName);
        expect(at("lands")).toEqual(["Plains"]);
        expect(at(0)).toEqual(["Mox Pearl"]);
        expect(at(1)).toEqual(["Lightning Bolt"]);
        expect(at(5)).toEqual(["Serra Angel"]);
    });

    it("honours a manual override — a card moves out of its auto column", () => {
        const override = (cardId: string) =>
            cardId === LIGHTNING_BOLT.cardId ? (6 as const) : undefined;
        const columns = groupDeckIntoFixedColumns([LIGHTNING_BOLT], override);
        expect(columns.find((c) => c.column === 1)!.cards).toHaveLength(0);
        expect(
            columns.find((c) => c.column === 6)!.cards.map((c) => c.cardName)
        ).toEqual(["Lightning Bolt"]);
    });

    it("pins a non-land card into Lands when the override says 'lands'", () => {
        const override = () => "lands" as const;
        const columns = groupDeckIntoFixedColumns([LIGHTNING_BOLT], override);
        expect(
            columns
                .find((c) => c.column === "lands")!
                .cards.map((c) => c.cardName)
        ).toEqual(["Lightning Bolt"]);
    });
});
