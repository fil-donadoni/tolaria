// Arrow-key navigation across the deckbuilder card grid (issue #2593).
//
// The axes are DOM-derived, not geometric, because happy-dom has no layout —
// every `getBoundingClientRect()` is zeroes, so a geometric implementation
// would pass this file vacuously (`.claude/rules/chrome-debug.md`). The DOM
// shape asserted here is the real one: `deck-column-pile.tsx` renders a
// `[data-column]` per Column with the tiles stacked inside it, and the Columns
// sit side by side in a snap strip.
import { describe, it, expect, afterEach } from "vitest";
import {
    CARD_TILE_ATTR,
    isTileNavKey,
    moveCardTileFocus,
} from "../card-tile-keyboard";

/** Build `columns` Columns inside one pane, with the given tile counts. */
function grid(counts: number[]): HTMLElement[][] {
    const pane = document.createElement("div");
    pane.setAttribute("data-deck-pane", "maindeck");
    document.body.append(pane);
    return counts.map((n, c) => {
        const column = document.createElement("div");
        column.setAttribute("data-column", `c${c}`);
        pane.append(column);
        return Array.from({ length: n }, (_, r) => {
            const tile = document.createElement("div");
            tile.setAttribute(CARD_TILE_ATTR, "");
            tile.setAttribute("tabindex", "0");
            tile.id = `c${c}r${r}`;
            column.append(tile);
            return tile;
        });
    });
}

const focused = () => document.activeElement?.id ?? null;

afterEach(() => {
    document.body.innerHTML = "";
});

describe("moveCardTileFocus (issue #2593)", () => {
    it("Up/Down step through the pile of the current Column", () => {
        const [col] = grid([3]);
        col[0].focus();
        expect(moveCardTileFocus(col[0], "ArrowDown")).toBe(true);
        expect(focused()).toBe("c0r1");
        expect(moveCardTileFocus(col[1], "ArrowUp")).toBe(true);
        expect(focused()).toBe("c0r0");
    });

    it("Left/Right cross to the adjacent Column at the same depth", () => {
        const cols = grid([3, 3, 3]);
        expect(moveCardTileFocus(cols[1][2], "ArrowLeft")).toBe(true);
        expect(focused()).toBe("c0r2");
        expect(moveCardTileFocus(cols[0][2], "ArrowRight")).toBe(true);
        expect(focused()).toBe("c1r2");
    });

    it("clamps to the last tile when the adjacent Column is shorter", () => {
        const cols = grid([4, 2]);
        expect(moveCardTileFocus(cols[0][3], "ArrowRight")).toBe(true);
        expect(focused()).toBe("c1r1");
    });

    it("reports no move at the edges, so the key falls through to scrolling", () => {
        const cols = grid([2, 2]);
        expect(moveCardTileFocus(cols[0][0], "ArrowUp")).toBe(false);
        expect(moveCardTileFocus(cols[0][0], "ArrowLeft")).toBe(false);
        expect(moveCardTileFocus(cols[1][1], "ArrowDown")).toBe(false);
        expect(moveCardTileFocus(cols[1][1], "ArrowRight")).toBe(false);
    });

    it("Home/End jump to the ends of the current Column only", () => {
        const cols = grid([4, 4]);
        expect(moveCardTileFocus(cols[1][2], "Home")).toBe(true);
        expect(focused()).toBe("c1r0");
        expect(moveCardTileFocus(cols[1][0], "End")).toBe(true);
        expect(focused()).toBe("c1r3");
    });

    it("never leaves the pane the run started in", () => {
        grid([2]); // pane A
        const cols = grid([2]); // pane B
        expect(moveCardTileFocus(cols[0][1], "ArrowDown")).toBe(false);
        expect(moveCardTileFocus(cols[0][0], "ArrowUp")).toBe(false);
    });

    it("collapses both axes onto prev/next when there is a single Column", () => {
        const [col] = grid([3]);
        expect(moveCardTileFocus(col[0], "ArrowRight")).toBe(true);
        expect(focused()).toBe("c0r1");
        expect(moveCardTileFocus(col[1], "ArrowLeft")).toBe(true);
        expect(focused()).toBe("c0r0");
    });

    it("recognises exactly the six navigation keys", () => {
        for (const key of [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
        ])
            expect(isTileNavKey(key)).toBe(true);
        for (const key of ["Enter", " ", "s", "Tab", "PageDown"])
            expect(isTileNavKey(key)).toBe(false);
    });
});
