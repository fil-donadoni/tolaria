// Pool Arrangement pure-logic tests (ADR 0060, issue #1247, seam 1). See
// `convex/limited/poolArrangement.ts`'s module comment for the design: an
// Arrangement entry is keyed by `poolIndex` (a seat's Pool array position),
// and an untouched card defaults to the Maindeck, its own (auto) Mana-Value
// column.
import { describe, it, expect } from "vitest";
import type { LimitedPoolCard, PoolArrangementEntry } from "../eventTypes";
import {
    findMovablePoolIndex,
    resolvePoolPlacements,
    splitPoolByArrangement,
    upsertPoolArrangementEntry,
} from "../poolArrangement";

function card(cardId: string, cardName = cardId): LimitedPoolCard {
    return { scryfallId: `s-${cardId}`, cardId, cardName };
}

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
