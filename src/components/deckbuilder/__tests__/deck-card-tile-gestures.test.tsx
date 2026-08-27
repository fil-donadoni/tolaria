// The deckbuilder card tile's optional double-click / right-click gestures
// (issue #2861, the Draft Room's desktop Pool/Sideboard menu). Both are
// absent by default — every BUILD-view/Constructed caller passes neither, so
// this only guards the two props the Draft Room's desktop wiring newly adds.
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

describe("DeckCardTile onDoubleClick / onContextMenu (issue #2861)", () => {
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

    // Review finding (issue #2861 PR #2881): the tile used to forward the
    // native `contextmenu` event to `onContextMenu` verbatim, so the caller
    // had to remember to call `preventDefault` itself — and the one caller
    // that mattered (`DeckZoneSurface`, wiring the Draft Room's desktop
    // Pool/Sideboard right-click) built a zero-argument closure that
    // discarded the event entirely, leaving the browser's native menu
    // popping up ON TOP of the Inspect Overlay this gesture is supposed to
    // open instead. The tile now calls `preventDefault` itself so no caller
    // can forget it.
    it("calls preventDefault on a real right-click before invoking onContextMenu", () => {
        const onContextMenu = vi.fn();
        const { getByTitle } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="a"
                    dragData={dragData(BOLT_ID)}
                    title="tile"
                    onClick={vi.fn()}
                    onContextMenu={onContextMenu}
                />
            </DragDropProvider>
        );
        const event = fireEvent.contextMenu(getByTitle("tile"));
        // `fireEvent` returns `false` when any handler called `preventDefault`
        // on a cancelable event — the same signal a real browser uses to
        // decide whether to still show its native menu.
        expect(event).toBe(false);
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("binds no contextmenu listener at all when onContextMenu is absent", () => {
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
        // No handler bound: the native menu is left alone (not prevented).
        const event = fireEvent.contextMenu(getByTitle("tile"));
        expect(event).toBe(true);
    });
});
