// Duplicate collapsing for the phone MV rows (issue #2584). The load-bearing
// property is NOT the count badge — it is that the surviving tile is one
// COPY, whole: its drag id, its drag payload (with that copy's `pinKey`) and
// its click handler are the first copy's, untouched. A collapse that merged
// them would make "select/move acts on one copy" false, and the failure is
// silent: the deck would just lose four cards instead of one.
import { describe, it, expect, vi } from "vitest";
import { collapseDuplicateTiles } from "../deckZoneRows";
import type { DeckPileTile } from "../deck-column-pile";

function tile(
    cardId: string,
    idx: number,
    onClick: () => void = () => {}
): DeckPileTile {
    return {
        key: `mv:1:${cardId}:${idx}`,
        cardId,
        dragId: `maindeck:mv:1:${cardId}:${idx}`,
        dragData: { kind: "main", cardId, cardName: cardId, pinKey: `p${idx}` },
        title: `Remove ${cardId}`,
        onClick,
        stackIndex: idx,
    };
}

describe("collapseDuplicateTiles (issue #2584)", () => {
    it("keeps one tile per distinct card, in first-appearance order, with its copy count", () => {
        const rows = collapseDuplicateTiles([
            tile("bolt", 0),
            tile("bolt", 1),
            tile("plains", 2),
            tile("bolt", 3),
        ]);
        expect(rows.map((r) => [r.cardId, r.count])).toEqual([
            ["bolt", 3],
            ["plains", 1],
        ]);
    });

    it("keeps the FIRST copy's identity — the drag id, the pin key and the click handler are that copy's, not a merge", () => {
        const first = vi.fn();
        const second = vi.fn();
        const [row] = collapseDuplicateTiles([
            tile("bolt", 0, first),
            tile("bolt", 1, second),
        ]);
        expect(row.dragId).toBe("maindeck:mv:1:bolt:0");
        expect(row.dragData.pinKey).toBe("p0");
        expect(row.key).toBe("mv:1:bolt:0");
        row.onClick();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });

    it("drops `stackIndex` — a row lays its tiles side by side, a pile's staggered absolute `top` would push them out of the box", () => {
        const [row] = collapseDuplicateTiles([tile("bolt", 2)]);
        expect(row.stackIndex).toBeUndefined();
    });

    it("returns an empty row for an empty Column rather than inventing a tile", () => {
        expect(collapseDuplicateTiles([])).toEqual([]);
    });
});
