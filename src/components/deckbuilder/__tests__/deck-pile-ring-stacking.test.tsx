// Issue #3426, second symptom. `.card-ring::after` carries `z-index: 25` — a
// WITHIN-CARD order (above the art and its tints, below the badges). A stacked
// `DeckCardTile` is `absolute` at `z-index: auto` and so forms NO stacking
// context, which means that 25 was resolved against the PILE instead: a buried
// card's whole ring rectangle outranked every later sibling tile and painted
// over their art, so a Column holding four copies read as a lattice of rings
// rather than a stack of outlined cards. `CARD_RING_TILE_CLASS` (`isolate`) is
// the containment the ring's own `z-index` already assumed.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { CARD_RING_TILE_CLASS } from "~/lib/card-ring";
import DeckCardTile from "../deck-card-tile";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

function dragData(id: string): CardDragData {
    return { cardId: id } as CardDragData;
}

function renderStack(count: number) {
    return render(
        <DragDropProvider>
            <div style={{ position: "relative" }}>
                {Array.from({ length: count }, (_, idx) => (
                    <DeckCardTile
                        key={idx}
                        cardId={BOLT_ID}
                        dragId={`tile-${idx}`}
                        dragData={dragData(BOLT_ID)}
                        title={`tile-${idx}`}
                        onClick={() => {}}
                        stackIndex={idx}
                        isSelected={idx === 0}
                    />
                ))}
            </div>
        </DragDropProvider>
    );
}

afterEach(cleanup);

describe("DeckCardTile ring containment in an overlapping pile (issue #3426)", () => {
    it("every stacked tile is its own stacking context, so a buried card's ring cannot paint over the tiles on top of it", () => {
        const { container } = renderStack(4);
        const tiles = Array.from(
            container.querySelectorAll('[role="button"]')
        ) as HTMLElement[];
        expect(tiles).toHaveLength(4);
        for (const tile of tiles) {
            expect(tile.className).toContain(CARD_RING_TILE_CLASS);
            // The rings the isolation contains are the tile's OWN descendants.
            expect(tile.querySelector(".card-ring")).not.toBeNull();
        }
    });

    it("keeps the pile's lift cues, which order a tile against its pile-mates and are not what isolation replaces", () => {
        const { container } = renderStack(2);
        const tiles = Array.from(
            container.querySelectorAll('[role="button"]')
        ) as HTMLElement[];
        for (const tile of tiles) {
            expect(tile.className).toContain("hover:z-10");
            expect(tile.className).toContain("focus-visible:z-20");
        }
        // The selected tile keeps its own lift on top of the isolation.
        expect(tiles[0].className).toContain("z-10");
    });

    it("leaves the WITHIN-card order alone: the ring overlays still follow the art in DOM order", () => {
        const { container } = renderStack(1);
        const tile = container.querySelector('[role="button"]') as HTMLElement;
        const children = Array.from(tile.children);
        const artIdx = children.findIndex(
            (el) => el.tagName === "IMG" || el.querySelector("img") !== null
        );
        const ringIdx = children.findIndex((el) =>
            el.classList.contains("card-ring")
        );
        expect(artIdx).toBeGreaterThan(-1);
        expect(ringIdx).toBeGreaterThan(artIdx);
    });
});
