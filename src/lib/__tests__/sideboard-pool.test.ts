// The Sideboarding window's view model and its undo helper (issue #9820).
import { describe, expect, it } from "vitest";
import { setMaindeckCount, type SideboardSplit } from "../deckSideboard";
import {
    buildSideboardPool,
    groupSideboardRows,
    moveCopies,
    sideboardChangeTotals,
    sideboardDragLabel,
    zoneChange,
    type SideboardDrag,
} from "../sideboard-pool";

// Real Cards, so the type groups and mana values resolve.
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const DISENCHANT = "2722d7e2-61c6-4934-9c21-875ee78fd06c";
const SERRA = "f8ac5006-91bd-4803-93da-f87cf196dd2f";

function copies(n: number, cardId: string) {
    return Array.from({ length: n }, () => ({ cardId, cardName: cardId }));
}

const START: SideboardSplit = {
    cards: [...copies(3, BOLT), ...copies(1, DISENCHANT)],
    sideboard: copies(2, SERRA),
};

describe("setMaindeckCount", () => {
    it("moves the difference either way and preserves the pool", () => {
        const out = moveCopies(START, BOLT, "side", true);
        const back = setMaindeckCount(out, BOLT, 3);
        expect(back.cards.filter((c) => c.cardId === BOLT)).toHaveLength(3);
        const down = setMaindeckCount(START, BOLT, 1);
        expect(down.cards.filter((c) => c.cardId === BOLT)).toHaveLength(1);
        expect(down.sideboard.filter((c) => c.cardId === BOLT)).toHaveLength(2);
        expect(down.cards.length + down.sideboard.length).toBe(6);
    });

    it("clamps a target beyond the copies the pool holds", () => {
        const up = setMaindeckCount(START, SERRA, 9);
        expect(up.cards.filter((c) => c.cardId === SERRA)).toHaveLength(2);
        expect(up.sideboard).toHaveLength(0);
    });
});

describe("buildSideboardPool", () => {
    it("one row per card with both zones' copies, its start count and delta", () => {
        const now = moveCopies(START, BOLT, "side", false);
        const rows = buildSideboardPool(START, now);
        const bolt = rows.find((r) => r.cardId === BOLT)!;
        expect(bolt).toMatchObject({
            main: 2,
            side: 1,
            startMain: 3,
            delta: -1,
        });
        expect(zoneChange(bolt, "main")).toBe("reduced");
        expect(zoneChange(bolt, "side")).toBe("gained");
        expect(sideboardChangeTotals(rows)).toEqual({ ins: 0, outs: 1 });
    });

    it("groups by type in display order", () => {
        const groups = groupSideboardRows(buildSideboardPool(START, START));
        expect(groups.map((g) => g.group)).toEqual(["Creatures", "Spells"]);
        expect(groups[1].rows.map((r) => r.cardId)).toEqual([BOLT, DISENCHANT]);
    });
});

describe("sideboardDragLabel", () => {
    const row = buildSideboardPool(START, START).find(
        (r) => r.cardId === BOLT
    )!;
    const drag = (
        over: SideboardDrag["over"],
        overAll = false,
        shift = false
    ) =>
        ({
            cardId: BOLT,
            from: "main",
            x: 0,
            y: 0,
            over,
            overAll,
            shift,
        }) as const;

    it("names the drop the gesture would make", () => {
        expect(sideboardDragLabel(drag(null), row)).toBe("Drag to Sideboard");
        expect(sideboardDragLabel(drag("main"), row)).toBe("Drag to Sideboard");
        expect(sideboardDragLabel(drag("side"), row)).toBe(
            "1 copy → Sideboard"
        );
        expect(sideboardDragLabel(drag("side", true), row)).toBe(
            "All 3 → Sideboard"
        );
        expect(sideboardDragLabel(drag("side", false, true), row)).toBe(
            "All 3 → Sideboard"
        );
    });
});
