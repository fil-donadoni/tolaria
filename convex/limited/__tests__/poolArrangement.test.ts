// Pool Arrangement pure-logic tests (ADR 0060, issue #1247, seam 1). See
// `convex/limited/poolArrangement.ts`'s module comment for the design: an
// Arrangement entry is keyed by `poolIndex` (a seat's Pool array position),
// and an untouched card defaults to the Maindeck, its own (auto) Mana-Value
// column.
import { describe, it, expect } from "vitest";
import type { LimitedPoolCard, PoolArrangementEntry } from "../eventTypes";
import {
    columnOverridesByCardId,
    findColumnOverrideablePoolIndex,
    findMovablePoolIndex,
    resolvePoolPlacements,
    splitPoolByArrangement,
    upsertPoolArrangementEntry,
} from "../poolArrangement";

function card(cardId: string, cardName = cardId): LimitedPoolCard {
    return { scryfallId: `s-${cardId}`, cardId, cardName };
}

// Real registry ids — the deckbuilder column helpers resolve a card's auto
// column via the card registry, but `columnOverridesByCardId` /
// `findColumnOverrideablePoolIndex` only read the RECORDED override + card
// id, so synthetic ids are fine here (no registry lookup on this path).
describe("columnOverridesByCardId (issue #1575)", () => {
    it("maps each cardId that has a recorded column override, skipping auto-column cards", () => {
        const pool = [card("bolt"), card("plains"), card("goblin")];
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, column: 5 },
            { poolIndex: 1, column: "lands" },
            // poolIndex 2 (goblin) has no override → absent from the map.
        ];
        const map = columnOverridesByCardId(pool, arrangement);
        expect(map.get("bolt")).toBe(5);
        expect(map.get("plains")).toBe("lands");
        expect(map.has("goblin")).toBe(false);
    });

    it("is empty for an untouched (undefined) arrangement", () => {
        const pool = [card("bolt")];
        expect(columnOverridesByCardId(pool, undefined).size).toBe(0);
    });

    it("last copy wins when two copies of one card carry divergent overrides", () => {
        const pool = [card("bolt"), card("bolt")];
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, column: 1 },
            { poolIndex: 1, column: 6 },
        ];
        expect(columnOverridesByCardId(pool, arrangement).get("bolt")).toBe(6);
    });
});

describe("findColumnOverrideablePoolIndex (issue #1575)", () => {
    it("returns the poolIndex of a Maindeck copy in preference to a Sideboard one", () => {
        const pool = [card("bolt"), card("bolt")];
        // poolIndex 0 is sideboarded; poolIndex 1 stays in the Maindeck.
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, sideboard: true },
        ];
        expect(findColumnOverrideablePoolIndex(pool, arrangement, "bolt")).toBe(
            1
        );
    });

    it("falls back to any copy when every copy is in the Sideboard", () => {
        const pool = [card("bolt")];
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, sideboard: true },
        ];
        expect(findColumnOverrideablePoolIndex(pool, arrangement, "bolt")).toBe(
            0
        );
    });

    it("returns null for a card not in the Pool (a Basic land added from the bar)", () => {
        const pool = [card("bolt")];
        expect(
            findColumnOverrideablePoolIndex(pool, [], "mountain")
        ).toBeNull();
    });
});

describe("upsertPoolArrangementEntry (ADR 0060, issue #1247)", () => {
    it("adds a fresh sideboard entry for a previously-untouched poolIndex", () => {
        const next = upsertPoolArrangementEntry([], {
            poolIndex: 2,
            sideboard: true,
        });
        expect(next).toEqual([{ poolIndex: 2, sideboard: true }]);
    });

    it("adds a fresh column-override entry", () => {
        const next = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: 4,
        });
        expect(next).toEqual([{ poolIndex: 0, column: 4 }]);
    });

    it("adds a fresh 'lands' column-override entry (issue #1573: any card can be manually pinned into Lands)", () => {
        const next = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "lands",
        });
        expect(next).toEqual([{ poolIndex: 0, column: "lands" }]);
    });

    it("moving a 'lands'-pinned card back to a Mana-Value column clears the override symmetrically", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, column: "lands" },
        ];
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 0,
            column: 3,
        });
        expect(next).toEqual([{ poolIndex: 0, column: 3 }]);
    });

    it("merges a patch into an existing entry, preserving the untouched dimension", () => {
        const existing: PoolArrangementEntry[] = [{ poolIndex: 1, column: 3 }];
        // Only patches `sideboard` — `column: 3` must survive untouched.
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 1,
            sideboard: true,
        });
        expect(next).toEqual([{ poolIndex: 1, column: 3, sideboard: true }]);
    });

    it("column: null explicitly clears a manual override back to auto", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 1, column: 3, sideboard: true },
        ];
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 1,
            column: null,
        });
        expect(next).toEqual([{ poolIndex: 1, sideboard: true }]);
    });

    it("drops the entry entirely once it returns to the fully-default state", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 1, sideboard: true },
        ];
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 1,
            sideboard: false,
        });
        expect(next).toEqual([]);
    });

    it("never mutates the input array", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, sideboard: true },
        ];
        const frozen = Object.freeze([...existing]);
        expect(() =>
            upsertPoolArrangementEntry(frozen, {
                poolIndex: 1,
                sideboard: true,
            })
        ).not.toThrow();
        expect(existing).toEqual([{ poolIndex: 0, sideboard: true }]);
    });

    it("keeps the result sorted by poolIndex regardless of edit order", () => {
        let arrangement: PoolArrangementEntry[] = [];
        arrangement = upsertPoolArrangementEntry(arrangement, {
            poolIndex: 5,
            sideboard: true,
        });
        arrangement = upsertPoolArrangementEntry(arrangement, {
            poolIndex: 1,
            sideboard: true,
        });
        expect(arrangement.map((e) => e.poolIndex)).toEqual([1, 5]);
    });
});

describe("resolvePoolPlacements / splitPoolByArrangement (ADR 0060, issue #1247)", () => {
    const pool: LimitedPoolCard[] = [
        card("bolt", "Lightning Bolt"),
        card("bolt", "Lightning Bolt"), // duplicate copy, same cardId
        card("giant-growth", "Giant Growth"),
    ];

    it("an untouched (undefined) Arrangement defaults every card to the Maindeck — continuous draft→build (ADR 0060)", () => {
        const placements = resolvePoolPlacements(pool, undefined);
        expect(placements.every((p) => p.sideboard === false)).toBe(true);
        expect(placements.every((p) => p.columnOverride === undefined)).toBe(
            true
        );

        const split = splitPoolByArrangement(pool, undefined);
        expect(split.cards).toHaveLength(3);
        expect(split.sideboard).toHaveLength(0);
    });

    it("an empty Arrangement array behaves identically to undefined", () => {
        const split = splitPoolByArrangement(pool, []);
        expect(split.cards).toHaveLength(3);
        expect(split.sideboard).toHaveLength(0);
    });

    it("honours a recorded sideboard flag for one specific poolIndex, leaving the duplicate copy alone", () => {
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, sideboard: true },
        ];
        const placements = resolvePoolPlacements(pool, arrangement);
        expect(placements[0].sideboard).toBe(true); // the sideboarded copy
        expect(placements[1].sideboard).toBe(false); // the OTHER Bolt copy stays main
        expect(placements[2].sideboard).toBe(false);

        const split = splitPoolByArrangement(pool, arrangement);
        expect(split.cards).toHaveLength(2);
        expect(split.sideboard).toEqual([
            { cardId: "bolt", cardName: "Lightning Bolt" },
        ]);
    });

    it("carries a manual column override through as columnOverride, distinct from sideboard membership", () => {
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 2, column: 0 },
        ];
        const placements = resolvePoolPlacements(pool, arrangement);
        expect(placements[2].columnOverride).toBe(0);
        expect(placements[2].sideboard).toBe(false);
    });

    it("carries a 'lands' column override through as columnOverride (issue #1573)", () => {
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, column: "lands" },
        ];
        const placements = resolvePoolPlacements(pool, arrangement);
        expect(placements[0].columnOverride).toBe("lands");
        expect(placements[0].sideboard).toBe(false);
    });
});

describe("findMovablePoolIndex (ADR 0060, issue #1247)", () => {
    const pool: LimitedPoolCard[] = [
        card("bolt", "Lightning Bolt"),
        card("bolt", "Lightning Bolt"),
        card("shock", "Shock"),
    ];

    it("finds the first main-side copy of a duplicated cardId to move to the sideboard", () => {
        const placements = resolvePoolPlacements(pool, undefined);
        const idx = findMovablePoolIndex(placements, "bolt", false);
        expect(idx).toBe(0);
    });

    it("after poolIndex 0 is sideboarded, resolves the SECOND copy as the remaining main-side match", () => {
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, sideboard: true },
        ];
        const placements = resolvePoolPlacements(pool, arrangement);
        const idx = findMovablePoolIndex(placements, "bolt", false);
        expect(idx).toBe(1);
    });

    it("finds a sideboarded copy to move back to the Maindeck", () => {
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 1, sideboard: true },
        ];
        const placements = resolvePoolPlacements(pool, arrangement);
        const idx = findMovablePoolIndex(placements, "bolt", true);
        expect(idx).toBe(1);
    });

    it("returns null when no card in the requested zone matches — stale UI state, never throws", () => {
        const placements = resolvePoolPlacements(pool, undefined);
        expect(findMovablePoolIndex(placements, "shock", true)).toBeNull();
        expect(findMovablePoolIndex(placements, "no-such-card", false)).toBe(
            null
        );
    });
});
