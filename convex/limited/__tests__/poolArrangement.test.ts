// Pool Arrangement pure-logic tests (ADR 0060, issue #1247, seam 1). See
// `convex/limited/poolArrangement.ts`'s module comment for the design: an
// Arrangement entry is keyed by `poolIndex` (a seat's Pool array position),
// and an untouched card defaults to the Maindeck, its own (auto) Mana-Value
// column.
import { describe, it, expect } from "vitest";
import { makeColumnId } from "../../deckLayout";
import type { LimitedPoolCard, PoolArrangementEntry } from "../eventTypes";
import {
    findMovablePoolIndex,
    mvColumnFromPins,
    pinsByPoolIndex,
    poolIndexForCopy,
    readEntryPins,
    resolvePoolPlacements,
    splitPoolByArrangement,
    upsertPoolArrangementEntry,
} from "../poolArrangement";

function card(cardId: string, cardName = cardId): LimitedPoolCard {
    return { scryfallId: `s-${cardId}`, cardId, cardName };
}

// The shared zone surface reads a card's Pins by the key the copy is recorded
// under — `String(poolIndex)` here (issue #1626). `pinsByPoolIndex` /
// `poolIndexForCopy` only read the RECORDED entry + card id, so synthetic ids
// are fine here (no registry lookup on this path).
describe("pinsByPoolIndex (issue #1575, namespaced #1622, per-copy #1626)", () => {
    it("maps each poolIndex that carries a Pin, skipping auto-column cards", () => {
        const pool = [card("bolt"), card("plains"), card("goblin")];
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, column: 5 },
            { poolIndex: 1, column: "lands" },
            // poolIndex 2 (goblin) has no Pin → absent from the map.
        ];
        const pins = pinsByPoolIndex(pool, arrangement);
        expect(pins["0"]).toEqual({ mv: makeColumnId("mv", "5") });
        expect(pins["1"]).toEqual({ mv: makeColumnId("mv", "lands") });
        expect(pins["2"]).toBeUndefined();
    });

    it("reads a NEW-shape entry's Pins through unchanged, every namespace", () => {
        const pool = [card("bolt")];
        const arrangement: PoolArrangementEntry[] = [
            {
                poolIndex: 0,
                pins: {
                    mv: makeColumnId("mv", "3"),
                    color: makeColumnId("color", "R"),
                    custom: makeColumnId("custom", "combo"),
                },
            },
        ];
        expect(pinsByPoolIndex(pool, arrangement)["0"]).toEqual({
            mv: "mv:3",
            color: "color:R",
            custom: "custom:combo",
        });
    });

    it("is empty for an untouched (undefined) arrangement", () => {
        const pool = [card("bolt")];
        expect(Object.keys(pinsByPoolIndex(pool, undefined)).length).toBe(0);
    });

    // The regression this slice exists to close (issue #1626 AC: "in Limited,
    // two copies of the same card can be pinned to different columns"). Its
    // predecessor `pinsByCardId` keyed by card id, so the second copy's Pin
    // overwrote the first's and only one of the two could ever be filed.
    it("keeps two copies of one card in SEPARATE columns", () => {
        const pool = [card("bolt"), card("bolt")];
        const arrangement: PoolArrangementEntry[] = [
            { poolIndex: 0, column: 1 },
            { poolIndex: 1, column: 6 },
        ];
        const pins = pinsByPoolIndex(pool, arrangement);
        expect(pins["0"]).toEqual({ mv: makeColumnId("mv", "1") });
        expect(pins["1"]).toEqual({ mv: makeColumnId("mv", "6") });
    });
});

describe("poolIndexForCopy (issue #1626)", () => {
    it("names the Nth physical copy of a card, in Pool order", () => {
        const pool = [card("bolt"), card("plains"), card("bolt")];
        expect(poolIndexForCopy(pool, "bolt", 0)).toBe(0);
        expect(poolIndexForCopy(pool, "bolt", 1)).toBe(2);
        expect(poolIndexForCopy(pool, "plains", 0)).toBe(1);
    });

    it("returns null past the last copy — and for a card the Pool never held", () => {
        const pool = [card("bolt")];
        // A Basic land added from the bar has no poolIndex, so it can never be
        // pinned; the caller turns this into a no-op rather than into some
        // other card's Pin.
        expect(poolIndexForCopy(pool, "mountain", 0)).toBeNull();
        expect(poolIndexForCopy(pool, "bolt", 1)).toBeNull();
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

    // Issue #1621: the emitted shape is the namespaced Card Pin map, never the
    // deprecated `column` field — see the `upsertPoolArrangementEntry emits
    // only the new pin shape` block below for the full write-shape contract.
    it("adds a fresh column-override entry", () => {
        const next = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: 4,
        });
        expect(next).toEqual([{ poolIndex: 0, pins: { mv: "mv:4" } }]);
    });

    it("adds a fresh 'lands' column-override entry (issue #1573: any card can be manually pinned into Lands)", () => {
        const next = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "lands",
        });
        expect(next).toEqual([{ poolIndex: 0, pins: { mv: "mv:lands" } }]);
    });

    it("moving a 'lands'-pinned card back to a Mana-Value column clears the override symmetrically", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { mv: "mv:lands" } },
        ];
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 0,
            column: 3,
        });
        expect(next).toEqual([{ poolIndex: 0, pins: { mv: "mv:3" } }]);
    });

    it("merges a patch into an existing entry, preserving the untouched dimension", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 1, pins: { mv: "mv:3" } },
        ];
        // Only patches `sideboard` — the `mv` Pin must survive untouched.
        const next = upsertPoolArrangementEntry(existing, {
            poolIndex: 1,
            sideboard: true,
        });
        expect(next).toEqual([
            { poolIndex: 1, pins: { mv: "mv:3" }, sideboard: true },
        ]);
    });

    it("column: null explicitly clears a manual override back to auto", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 1, pins: { mv: "mv:3" }, sideboard: true },
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

// ────────────────────────────────────────────────────────────────────────────
// Tolerant read: the deprecated `column` override → namespaced Card Pins
// (ADR 0075 §5, PRD #1617, issue #1621)
// ────────────────────────────────────────────────────────────────────────────

describe("readEntryPins — tolerant read of the legacy column (ADR 0075 §5, issue #1621)", () => {
    it("reads the LEGACY shape: a numeric column becomes an mv Pin on that column's id", () => {
        expect(readEntryPins({ poolIndex: 0, column: 5 })).toEqual({
            mv: "mv:5",
        });
    });

    it("reads the LEGACY shape: column 'lands' becomes an mv Pin on mv:lands", () => {
        expect(readEntryPins({ poolIndex: 0, column: "lands" })).toEqual({
            mv: "mv:lands",
        });
    });

    it("reads the NEW shape unchanged — an entry already carrying Pins passes through", () => {
        const pins = { mv: "mv:2", color: "color:R", custom: "custom:combo" };
        expect(readEntryPins({ poolIndex: 3, pins })).toEqual(pins);
    });

    it("an entry with NEITHER shape reads as no Pins at all", () => {
        expect(readEntryPins({ poolIndex: 0 })).toEqual({});
        expect(readEntryPins({ poolIndex: 0, sideboard: true })).toEqual({});
    });

    it("MIXED shapes: `pins` is the winner — the deprecated column loses the mv slot it collides on", () => {
        const mixed: PoolArrangementEntry = {
            poolIndex: 0,
            column: 5,
            pins: { mv: "mv:2" },
        };
        expect(readEntryPins(mixed).mv).toBe("mv:2");
    });

    it("MIXED shapes resolve per NAMESPACE: a colour Pin does not swallow the legacy column, and vice versa", () => {
        const mixed: PoolArrangementEntry = {
            poolIndex: 0,
            column: "lands",
            pins: { color: "color:R" },
        };
        // The colour Pin survives (it has no legacy counterpart to lose to)
        // AND the legacy column still fills the untaken `mv` slot.
        expect(readEntryPins(mixed)).toEqual({
            mv: "mv:lands",
            color: "color:R",
        });
    });

    it("never mutates the entry, and never hands back the entry's own pins object", () => {
        const entry: PoolArrangementEntry = {
            poolIndex: 0,
            pins: { mv: "mv:1" },
        };
        const read = readEntryPins(entry);
        read.color = "color:U";
        expect(entry.pins).toEqual({ mv: "mv:1" });
    });

    it("column ids come from the shared Column Layout engine, not a local copy", () => {
        // Same expectation, expressed through the engine's own minter — a
        // divergence in the id vocabulary fails here rather than shipping.
        expect(readEntryPins({ poolIndex: 0, column: 6 })).toEqual({
            mv: makeColumnId("mv", "6"),
        });
        expect(readEntryPins({ poolIndex: 0, column: "lands" })).toEqual({
            mv: makeColumnId("mv", "lands"),
        });
    });
});

describe("mvColumnFromPins — the mv Pin read back in the legacy column vocabulary (issue #1621)", () => {
    it("round-trips a numeric column and 'lands' through the Pin shape unchanged", () => {
        expect(
            mvColumnFromPins(readEntryPins({ poolIndex: 0, column: 4 }))
        ).toBe(4);
        expect(
            mvColumnFromPins(readEntryPins({ poolIndex: 0, column: "lands" }))
        ).toBe("lands");
    });

    it("is undefined with no mv Pin — a colour/custom Pin has no legacy counterpart", () => {
        expect(mvColumnFromPins({})).toBeUndefined();
        expect(
            mvColumnFromPins({ color: "color:R", custom: "custom:combo" })
        ).toBeUndefined();
    });

    it("is undefined for an mv Pin this shim can't express, rather than throwing", () => {
        expect(mvColumnFromPins({ mv: "mv:weird" })).toBeUndefined();
        expect(mvColumnFromPins({ mv: "catch-all" })).toBeUndefined();
    });
});

describe("upsertPoolArrangementEntry emits only the new pin shape (issue #1621)", () => {
    it("a fresh column edit persists `pins` and never the deprecated `column` field", () => {
        const [entry] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: 4,
        });
        expect(entry.pins).toEqual({ mv: "mv:4" });
        expect("column" in entry).toBe(false);
    });

    it("editing a LEGACY entry migrates it in place: the column field is gone, the placement is not", () => {
        const legacy: PoolArrangementEntry[] = [{ poolIndex: 0, column: 5 }];
        const [entry] = upsertPoolArrangementEntry(legacy, {
            poolIndex: 0,
            sideboard: true,
        });
        expect("column" in entry).toBe(false);
        expect(entry.pins).toEqual({ mv: "mv:5" });
        expect(entry.sideboard).toBe(true);
    });

    it("a sideboard-only edit on a legacy entry keeps that entry's resolved column identical", () => {
        const pool = [card("bolt")];
        const legacy: PoolArrangementEntry[] = [{ poolIndex: 0, column: 5 }];
        const before = resolvePoolPlacements(pool, legacy)[0].columnOverride;
        const after = resolvePoolPlacements(
            pool,
            upsertPoolArrangementEntry(legacy, {
                poolIndex: 0,
                sideboard: true,
            })
        )[0].columnOverride;
        expect(after).toBe(before);
        expect(after).toBe(5);
    });

    it("clearing the column of a legacy entry that has no other dimension DROPS it (default-drop rule still holds)", () => {
        const legacy: PoolArrangementEntry[] = [{ poolIndex: 1, column: 3 }];
        expect(
            upsertPoolArrangementEntry(legacy, { poolIndex: 1, column: null })
        ).toEqual([]);
    });

    it("an entry left with only a non-mv Pin is NOT default, so it survives the drop rule", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 1, pins: { mv: "mv:3", color: "color:R" } },
        ];
        expect(
            upsertPoolArrangementEntry(existing, { poolIndex: 1, column: null })
        ).toEqual([{ poolIndex: 1, pins: { color: "color:R" } }]);
    });

    it("clearing the column never erases a Pin in another namespace (ADR 0075 §3)", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { custom: "custom:combo", mv: "mv:2" } },
        ];
        const [entry] = upsertPoolArrangementEntry(existing, {
            poolIndex: 0,
            column: null,
        });
        expect(entry.pins).toEqual({ custom: "custom:combo" });
    });
});

// Issue #1624: the patch's `column` field carries the FULL Column id
// vocabulary, not only `mv`. The Limited Maindeck is `dropModel: "columns"`,
// so once the Grouping control can generate colour/type Columns every one of
// them is a live drop target — and a patch vocabulary that can only express
// `mv` turns each of those drops into a silent no-op.
describe("upsertPoolArrangementEntry accepts a namespaced Column id (issue #1624)", () => {
    it("a `color:` id records the COLOUR Pin, not an mv one", () => {
        const [entry] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "color:R",
        });
        expect(entry.pins).toEqual({ color: "color:R" });
    });

    it("a `type:` id records the TYPE Pin", () => {
        const [entry] = upsertPoolArrangementEntry([], {
            poolIndex: 2,
            column: "type:creature",
        });
        expect(entry.pins).toEqual({ type: "type:creature" });
    });

    it("a `custom:` id records the CUSTOM Pin (a user-created Column applies under every Grouping)", () => {
        const [entry] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "custom:combo",
        });
        expect(entry.pins).toEqual({ custom: "custom:combo" });
    });

    it("an `mv:` id is the same write as the legacy number it corresponds to", () => {
        const [viaId] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "mv:6",
        });
        const [viaLegacy] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: 6,
        });
        expect(viaId).toEqual(viaLegacy);
        expect(viaId.pins).toEqual({ mv: "mv:6" });
    });

    it('`mv:lands` and the legacy `"lands"` literal are the same write too', () => {
        const [viaId] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "mv:lands",
        });
        const [viaLegacy] = upsertPoolArrangementEntry([], {
            poolIndex: 0,
            column: "lands",
        });
        expect(viaId).toEqual(viaLegacy);
        expect(viaId.pins).toEqual({ mv: "mv:lands" });
    });

    it("pinning into a colour Column leaves the draft-built mv arrangement untouched (ADR 0075 §3)", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { mv: "mv:6" } },
        ];
        const [entry] = upsertPoolArrangementEntry(existing, {
            poolIndex: 0,
            column: "color:G",
        });
        expect(entry.pins).toEqual({ mv: "mv:6", color: "color:G" });
    });

    it("re-pinning within a namespace overwrites rather than stacking", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { color: "color:R" } },
        ];
        const [entry] = upsertPoolArrangementEntry(existing, {
            poolIndex: 0,
            column: "color:W",
        });
        expect(entry.pins).toEqual({ color: "color:W" });
    });

    // Fail-closed: an unnamespaced id is not a pin target, so it records
    // NOTHING — never a coercion into `mv`, which would silently move the
    // card in a namespace the player never touched.
    it.each(["catch-all", "all", "", "nonsense"])(
        "an unnamespaced id (%o) records no Pin at all",
        (columnId) => {
            expect(
                upsertPoolArrangementEntry([], {
                    poolIndex: 0,
                    column: columnId,
                })
            ).toEqual([]);
        }
    );

    it("an unnamespaced id leaves an EXISTING Pin exactly as it was", () => {
        const existing: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { mv: "mv:2" } },
        ];
        expect(
            upsertPoolArrangementEntry(existing, {
                poolIndex: 0,
                column: "catch-all",
            })
        ).toEqual(existing);
    });
});

describe("legacy and new shapes resolve to the SAME placement (issue #1621: nothing user-visible changes)", () => {
    const pool: LimitedPoolCard[] = [
        card("bolt", "Lightning Bolt"),
        card("plains", "Plains"),
    ];

    it("an in-flight event's legacy Arrangement resolves to exactly the columns it did before", () => {
        const legacy: PoolArrangementEntry[] = [
            { poolIndex: 0, column: 5 },
            { poolIndex: 1, column: "lands", sideboard: true },
        ];
        const migrated: PoolArrangementEntry[] = [
            { poolIndex: 0, pins: { mv: "mv:5" } },
            { poolIndex: 1, pins: { mv: "mv:lands" }, sideboard: true },
        ];
        // Same columns, same Maindeck/Sideboard membership, either way.
        expect(resolvePoolPlacements(pool, legacy)).toEqual(
            resolvePoolPlacements(pool, migrated)
        );
        expect(splitPoolByArrangement(pool, legacy)).toEqual(
            splitPoolByArrangement(pool, migrated)
        );
        expect(pinsByPoolIndex(pool, legacy)).toEqual(
            pinsByPoolIndex(pool, migrated)
        );
    });

    it("resolvePoolPlacements exposes the normalised Pins alongside the legacy-facing columnOverride", () => {
        const placements = resolvePoolPlacements(pool, [
            { poolIndex: 0, column: 5 },
        ]);
        expect(placements[0].pins).toEqual({ mv: "mv:5" });
        expect(placements[0].columnOverride).toBe(5);
        // An untouched card has no Pins at all, not a partially-filled map.
        expect(placements[1].pins).toEqual({});
        expect(placements[1].columnOverride).toBeUndefined();
    });
});
