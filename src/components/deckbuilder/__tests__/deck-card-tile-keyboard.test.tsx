// The deckbuilder card tile is operable from the keyboard (issue #2593).
//
// `DeckCardTile` has carried `role="button" tabIndex={0}` since #1581 with no
// `onKeyDown`: an ARIA role that promises an activation the keyboard could
// never fire, which is a WCAG 2.1.1 failure and not a cosmetic one — every
// zone surface in the app renders this tile, so the whole deckbuilder was
// pointer-only.
//
// The tests drive the REAL component through real key events rather than
// asserting the handler exists, because a tile that binds `onKeyDown` on a
// child it no longer renders would pass the second and fail a user.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import DeckCardTile from "../deck-card-tile";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

function dragData(id: string): CardDragData {
    return { cardId: id } as CardDragData;
}

/** Two Columns of two tiles each, in the DOM shape `DeckColumnPile` builds. */
function renderGrid(onClick = vi.fn()) {
    const result = render(
        <DragDropProvider>
            <div data-deck-pane="maindeck">
                {["a", "b"].map((col) => (
                    <div key={col} data-column={col}>
                        {[0, 1].map((row) => (
                            <DeckCardTile
                                key={row}
                                cardId={BOLT_ID}
                                dragId={`${col}${row}`}
                                dragData={dragData(BOLT_ID)}
                                title={`tile ${col}${row}`}
                                onClick={onClick}
                                stackIndex={row}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </DragDropProvider>
    );
    const tiles = [
        ...result.container.querySelectorAll<HTMLElement>("[data-card-tile]"),
    ];
    return { ...result, tiles, onClick };
}

const focusedTitle = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute("title") ??
    null;

afterEach(cleanup);

describe("DeckCardTile keyboard operation (issue #2593)", () => {
    it("is a tab stop that carries the card-tile marker", () => {
        const { tiles } = renderGrid();
        expect(tiles).toHaveLength(4);
        for (const tile of tiles) {
            expect(tile.getAttribute("role")).toBe("button");
            expect(tile.getAttribute("tabindex")).toBe("0");
        }
    });

    it("Enter fires the primary action", () => {
        const { tiles, onClick } = renderGrid();
        fireEvent.keyDown(tiles[0], { key: "Enter" });
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("Space fires the primary action", () => {
        const { tiles, onClick } = renderGrid();
        fireEvent.keyDown(tiles[0], { key: " " });
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does not fire the primary action on a modifier chord", () => {
        const { tiles, onClick } = renderGrid();
        fireEvent.keyDown(tiles[0], { key: "Enter", metaKey: true });
        fireEvent.keyDown(tiles[0], { key: "Enter", ctrlKey: true });
        expect(onClick).not.toHaveBeenCalled();
    });

    it("Down moves focus within the Column, Right crosses to the next one", () => {
        const { tiles } = renderGrid();
        tiles[0].focus();
        fireEvent.keyDown(tiles[0], { key: "ArrowDown" });
        expect(focusedTitle()).toBe("tile a1");
        fireEvent.keyDown(tiles[1], { key: "ArrowRight" });
        expect(focusedTitle()).toBe("tile b1");
    });

    it("an arrow never doubles as an activation", () => {
        const { tiles, onClick } = renderGrid();
        fireEvent.keyDown(tiles[0], { key: "ArrowDown" });
        fireEvent.keyDown(tiles[1], { key: "ArrowRight" });
        expect(onClick).not.toHaveBeenCalled();
    });

    it("keeps a visible focus indicator — no outline-none on the tab stop", () => {
        const { tiles } = renderGrid();
        // `outline-none` is what made the ring invisible before this issue;
        // the global `:focus-visible` rule (src/index.css, unlayered) is what
        // paints it, and a utility here would out-rank it again.
        expect(tiles[0].className).not.toContain("outline-none");
        expect(tiles[0].className).toContain("focus-visible:z-20");
    });
});
