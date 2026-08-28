// The deckbuilder card tile's optional double-click gesture (issue #2861,
// the Draft Room's desktop Pool/Sideboard menu). Absent by default — every
// BUILD-view/Constructed caller passes none, so this only guards the prop
// the Draft Room's desktop wiring adds.
//
// This file used to also cover an `onContextMenu` prop (issue #2861), which
// issue #2889 reverted end-to-end: a real right-click on the Draft Room's
// desktop regime now falls through to the ordinary `CardPreview` pin, same
// as everywhere else in the app, rather than opening the Inspect Overlay.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import DeckCardTile from "../deck-card-tile";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

function dragData(id: string): CardDragData {
    return { cardId: id } as CardDragData;
}

afterEach(cleanup);

describe("DeckCardTile onDoubleClick (issue #2861)", () => {
    it("fires onDoubleClick when supplied", () => {
        const onDoubleClick = vi.fn();
        const { getByTitle } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="a"
                    dragData={dragData(BOLT_ID)}
                    title="tile"
                    onClick={vi.fn()}
                    onDoubleClick={onDoubleClick}
                />
            </DragDropProvider>
        );
        fireEvent.doubleClick(getByTitle("tile"));
        expect(onDoubleClick).toHaveBeenCalledTimes(1);
    });

    it("binds no dblclick listener at all when onDoubleClick is absent — firing one is a no-op, never an error", () => {
        const { getByTitle } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="a"
                    dragData={dragData(BOLT_ID)}
                    title="tile"
                    onClick={vi.fn()}
                />
            </DragDropProvider>
        );
        expect(() => fireEvent.doubleClick(getByTitle("tile"))).not.toThrow();
    });
});
