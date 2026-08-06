// The draft-time Pool's column adapter, now a thin reshaping of the shared
// Column Layout engine's answer (issue #1622 — the local fixed-column ladder
// `resolveDisplayColumn` / `fixedColumnDescriptors` / `groupIntoFixedColumns`
// is gone). Every assertion below is the behaviour the ladder had, so a
// regression in the rewire is a red test, not a silent change to a live draft.
import { describe, it, expect } from "vitest";
import { MAX_MANA_VALUE_COLUMN } from "@convex/deckLayout";
import { resolvePoolPlacements } from "@convex/limited/poolArrangement";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { groupPoolIntoColumns, sideboardEntries } from "../limitedPoolColumns";

// Real registry ids (mirrors the convention in `limited-draft-pool.test.tsx`
// — the grouping resolves each card via the card registry).
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function poolCard(cardId: string, cardName: string): LimitedPoolCard {
    return { scryfallId: `s-${cardId}`, cardId, cardName };
}

const at = (
    columns: ReturnType<typeof groupPoolIntoColumns>,
    column: number | "lands"
) => columns.find((c) => c.column === column)!;

describe("groupPoolIntoColumns (ADR 0060, issue #1248; on the engine, issue #1622)", () => {
    it("renders every fixed column (Lands + MV 0..7+) even when empty", () => {
        const columns = groupPoolIntoColumns([]);
        expect(columns.map((c) => c.column)).toEqual([
            "lands",
            ...Array.from(
                { length: MAX_MANA_VALUE_COLUMN + 1 },
                (_, n) => n as number | "lands"
            ),
        ]);
        expect(columns.every((c) => c.entries.length === 0)).toBe(true);
    });

    it("labels the top column MV 7+ and the Lands column Lands", () => {
        const columns = groupPoolIntoColumns([]);
        expect(at(columns, MAX_MANA_VALUE_COLUMN).label).toBe("MV 7+");
        expect(at(columns, "lands").label).toBe("Lands");
    });

    it("buckets a Land card into Lands and a spell into its auto Mana Value column", () => {
        const placements = resolvePoolPlacements(
            [
                poolCard(BOLT_ID, "Lightning Bolt"),
                poolCard(PLAINS_ID, "Plains"),
            ],
            undefined
        );
        const columns = groupPoolIntoColumns(placements);
        expect(
            at(columns, "lands").entries.map((e) => e.card.cardName)
        ).toEqual(["Plains"]);
        expect(at(columns, 1).entries.map((e) => e.card.cardName)).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("a manual column override wins over the card's own auto Mana Value", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            [{ poolIndex: 0, column: 5 }]
        );
        const columns = groupPoolIntoColumns(placements);
        expect(at(columns, 1).entries).toHaveLength(0);
        expect(at(columns, 5).entries.map((e) => e.poolIndex)).toEqual([0]);
    });

    it("reads a NEW-shape (namespaced Pin) entry identically to the legacy column", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            [{ poolIndex: 0, pins: { mv: "mv:5" } }]
        );
        const columns = groupPoolIntoColumns(placements);
        expect(at(columns, 1).entries).toHaveLength(0);
        expect(at(columns, 5).entries.map((e) => e.poolIndex)).toEqual([0]);
    });

    it("a manual override can move a Land card into a numbered column", () => {
        const placements = resolvePoolPlacements(
            [poolCard(PLAINS_ID, "Plains")],
            [{ poolIndex: 0, column: 2 }]
        );
        const columns = groupPoolIntoColumns(placements);
        expect(at(columns, "lands").entries).toHaveLength(0);
        expect(at(columns, 2).entries).toHaveLength(1);
    });

    it("a manual 'lands' override moves a non-Land card into Lands (issue #1573)", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            [{ poolIndex: 0, column: "lands" }]
        );
        const columns = groupPoolIntoColumns(placements);
        expect(at(columns, 1).entries).toHaveLength(0);
        expect(at(columns, "lands").entries.map((e) => e.poolIndex)).toEqual([
            0,
        ]);
    });

    it("a Sideboard placement never appears in any Pool column", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            [{ poolIndex: 0, sideboard: true }]
        );
        expect(
            groupPoolIntoColumns(placements).every(
                (c) => c.entries.length === 0
            )
        ).toBe(true);
    });

    it("clamps a manual override above MV 7 into the shared 7+ bucket", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            [{ poolIndex: 0, column: 20 }]
        );
        expect(
            at(groupPoolIntoColumns(placements), MAX_MANA_VALUE_COLUMN).entries
        ).toHaveLength(1);
    });

    it("orders a column by card name, then by poolIndex", () => {
        const placements = resolvePoolPlacements(
            [
                poolCard(BOLT_ID, "Lightning Bolt"),
                poolCard(BOLT_ID, "Lightning Bolt"),
            ],
            undefined
        );
        expect(
            at(groupPoolIntoColumns(placements), 1).entries.map(
                (e) => e.poolIndex
            )
        ).toEqual([0, 1]);
    });

    it("keeps a card the registry has never heard of on the surface (MV 0), instead of throwing", () => {
        const placements = resolvePoolPlacements(
            [poolCard("11111111-2222-3333-4444-555555555555", "Unknown Card")],
            undefined
        );
        const columns = groupPoolIntoColumns(placements);
        expect(at(columns, 0).entries.map((e) => e.card.cardName)).toEqual([
            "Unknown Card",
        ]);
    });
});

describe("sideboardEntries", () => {
    it("returns only sideboarded placements, sorted by name", () => {
        const placements = resolvePoolPlacements(
            [
                poolCard(BOLT_ID, "Lightning Bolt"),
                poolCard(PLAINS_ID, "Plains"),
            ],
            [
                { poolIndex: 0, sideboard: true },
                { poolIndex: 1, sideboard: true },
            ]
        );
        expect(
            sideboardEntries(placements).map((e) => e.card.cardName)
        ).toEqual(["Lightning Bolt", "Plains"]);
    });

    it("returns an empty list when nothing is sideboarded", () => {
        const placements = resolvePoolPlacements(
            [poolCard(BOLT_ID, "Lightning Bolt")],
            undefined
        );
        expect(sideboardEntries(placements)).toEqual([]);
    });
});
