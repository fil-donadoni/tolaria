import { describe, it, expect } from "vitest";
import { resolvePoolPlacements } from "@convex/limited/poolArrangement";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import {
    groupPoolIntoColumns,
    resolveDisplayColumn,
    sideboardEntries,
    MAX_POOL_COLUMN,
} from "../limitedPoolColumns";

// Real registry ids (mirrors the convention in `limited-draft-pool.test.tsx`
// / `pool-deckbuilder-surface.test.tsx` — the grouping resolves each card
// via the card registry, so synthetic ids would throw).
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function poolCard(cardId: string, cardName: string): LimitedPoolCard {
    return { scryfallId: `s-${cardId}`, cardId, cardName };
}

describe("groupPoolIntoColumns (ADR 0060, issue #1248)", () => {
    it("renders every fixed column (Lands + MV 0..MAX_POOL_COLUMN) even when empty", () => {
        const columns = groupPoolIntoColumns([]);
        expect(columns.map((c) => c.key)).toEqual([
            "lands",
            ...Array.from({ length: MAX_POOL_COLUMN + 1 }, (_, n) => `mv-${n}`),
        ]);
        expect(columns.every((c) => c.entries.length === 0)).toBe(true);
    });

    it("buckets a Land card into Lands and a spell into its auto Mana Value column", () => {
        const pool = [
            poolCard(BOLT_ID, "Lightning Bolt"),
            poolCard(PLAINS_ID, "Plains"),
        ];
        const placements = resolvePoolPlacements(pool, undefined);
        const columns = groupPoolIntoColumns(placements);

        const lands = columns.find((c) => c.key === "lands")!;
        expect(lands.entries.map((e) => e.card.cardName)).toEqual(["Plains"]);

        const mv1 = columns.find((c) => c.key === "mv-1")!;
        expect(mv1.entries.map((e) => e.card.cardName)).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("a manual column override wins over the card's own auto Mana Value — a Bolt pinned to column 5 renders under MV 5, not MV 1", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: 5 },
        ]);
        const columns = groupPoolIntoColumns(placements);

        expect(columns.find((c) => c.key === "mv-1")!.entries).toHaveLength(0);
        expect(
            columns
                .find((c) => c.key === "mv-5")!
                .entries.map((e) => e.poolIndex)
        ).toEqual([0]);
    });

    it("a manual override can even move a Land card into a numbered column", () => {
        const pool = [poolCard(PLAINS_ID, "Plains")];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: 2 },
        ]);
        const columns = groupPoolIntoColumns(placements);

        expect(columns.find((c) => c.key === "lands")!.entries).toHaveLength(0);
        expect(columns.find((c) => c.key === "mv-2")!.entries).toHaveLength(1);
    });

    it("a manual 'lands' override moves a non-Land card into Lands — column placement is player organization, not a rules statement (issue #1573)", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: "lands" },
        ]);
        const columns = groupPoolIntoColumns(placements);

        expect(columns.find((c) => c.key === "mv-1")!.entries).toHaveLength(0);
        expect(
            columns
                .find((c) => c.key === "lands")!
                .entries.map((e) => e.poolIndex)
        ).toEqual([0]);
    });

    it("moving a 'lands'-pinned card back to a Mana-Value column resolves symmetrically", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        // Simulates the second drag: override set to "lands", then moved
        // back to column 3 (the arrangement entry itself would be
        // re-upserted server-side — here we assert the pure display
        // resolution for the post-move override value).
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: 3 },
        ]);
        const columns = groupPoolIntoColumns(placements);

        expect(columns.find((c) => c.key === "lands")!.entries).toHaveLength(
            0
        );
        expect(columns.find((c) => c.key === "mv-3")!.entries).toHaveLength(
            1
        );
    });

    it("a Sideboard placement never appears in any Pool column", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, sideboard: true },
        ]);
        const columns = groupPoolIntoColumns(placements);
        expect(columns.every((c) => c.entries.length === 0)).toBe(true);
    });

    it("clamps a manual override above MAX_POOL_COLUMN into the shared 7+ bucket", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: 20 },
        ]);
        const columns = groupPoolIntoColumns(placements);
        expect(
            columns.find((c) => c.key === `mv-${MAX_POOL_COLUMN}`)!.entries
        ).toHaveLength(1);
    });
});

describe("resolveDisplayColumn", () => {
    it("returns 'lands' for a Land card with no override", () => {
        expect(
            resolveDisplayColumn(poolCard(PLAINS_ID, "Plains"), undefined)
        ).toBe("lands");
    });

    it("returns the card's own Mana Value with no override", () => {
        expect(
            resolveDisplayColumn(poolCard(BOLT_ID, "Lightning Bolt"), undefined)
        ).toBe(1);
    });

    it("an override always wins, clamped to the fixed 0..MAX_POOL_COLUMN range", () => {
        expect(
            resolveDisplayColumn(poolCard(BOLT_ID, "Lightning Bolt"), 4)
        ).toBe(4);
        expect(
            resolveDisplayColumn(poolCard(BOLT_ID, "Lightning Bolt"), -1)
        ).toBe(0);
    });

    it("a 'lands' override wins for a non-Land card, regardless of its own type (issue #1573)", () => {
        expect(
            resolveDisplayColumn(poolCard(BOLT_ID, "Lightning Bolt"), "lands")
        ).toBe("lands");
    });
});

describe("sideboardEntries", () => {
    it("returns only sideboarded placements, sorted by name", () => {
        const pool = [
            poolCard(BOLT_ID, "Lightning Bolt"),
            poolCard(PLAINS_ID, "Plains"),
        ];
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, sideboard: true },
            { poolIndex: 1, sideboard: true },
        ]);
        expect(
            sideboardEntries(placements).map((e) => e.card.cardName)
        ).toEqual(["Lightning Bolt", "Plains"]);
    });

    it("returns an empty list when nothing is sideboarded", () => {
        const pool = [poolCard(BOLT_ID, "Lightning Bolt")];
        expect(
            sideboardEntries(resolvePoolPlacements(pool, undefined))
        ).toEqual([]);
    });
});
