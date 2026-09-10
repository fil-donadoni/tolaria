// The Unattended Pick ring (ADR 0095, issue #2271) — the draft Pool ONLY,
// via `isUnattended` on the shared `DeckCardTile`. Every other zone
// (Constructed Maindeck/Sideboard, Limited build view) leaves the prop unset
// and must render no ring at all.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import DeckCardTile from "../deck-card-tile";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

function dragData(id: string): CardDragData {
    return { cardId: id } as CardDragData;
}

afterEach(cleanup);

describe("DeckCardTile isUnattended (ADR 0095, issue #2271)", () => {
    it("renders the unattended-pick-ring overlay when isUnattended is true", () => {
        const { getByTestId } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="a"
                    dragData={dragData(BOLT_ID)}
                    title="tile"
                    onClick={() => {}}
                    isUnattended
                />
            </DragDropProvider>
        );
        const ring = getByTestId("unattended-pick-ring");
        expect(ring.className).toContain("card-ring");
    });

    it("renders no ring when isUnattended is false or absent", () => {
        const { queryByTestId } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="a"
                    dragData={dragData(BOLT_ID)}
                    title="tile"
                    onClick={() => {}}
                />
            </DragDropProvider>
        );
        expect(queryByTestId("unattended-pick-ring")).toBeNull();
    });
});
