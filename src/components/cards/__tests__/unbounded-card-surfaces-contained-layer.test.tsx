import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";

vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardImage from "../card-image";
import LimitedDraftPackCard from "~/components/limited/limited-draft-pack-card";
import DeckCardTile from "~/components/deckbuilder/deck-card-tile";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

/**
 * The surfaces that mount a whole pool or pack of printed faces render them
 * CONTAINED, never promoted to their own compositor layer (issue #6940).
 *
 * WHY A TEST. `check:ui`'s rasterisation probe sees the defect only when the
 * GPU budget is starved — under an ordinary budget a promoted face and a
 * contained one both read sharp, so the lane cannot red a tile that goes back
 * to `promoteLayer` default. Measured 2026-10-29 with
 * `--force-gpu-mem-available-mb=24`: promoted faces on the Draft pack grid and
 * the Limited pool builder were evicted to blank slots (2 of 10 cells);
 * contained faces on the same surfaces, same budget, were sharp on all 10.
 * This test is the mechanical half: the layer mode is a style the DOM can
 * see, and happy-dom can see it.
 */

afterEach(cleanup);

/** The CardImage slot wrapper — the element that carries the layer style. */
function slotOf(container: HTMLElement): HTMLElement {
    const slot = container.querySelector<HTMLElement>(
        ".card-corner.overflow-hidden"
    );
    if (!slot) throw new Error("no CardImage slot rendered");
    return slot;
}

describe("unbounded card surfaces render contained faces (issue #6940)", () => {
    it("positive control: CardImage's default is the promoted layer the board relies on", () => {
        const { container } = render(<CardImage card={{ id: BOLT_ID }} />);
        expect(slotOf(container).style.willChange).toBe("transform");
    });

    it("the Draft pack tile does not promote its face", () => {
        const { container } = render(
            <LimitedDraftPackCard
                card={{
                    scryfallId: "s1",
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                    pickId: "r0-p0-c0",
                }}
                selected={false}
                isDefault={false}
                onSelect={() => {}}
                pending={false}
            />
        );
        const slot = slotOf(container);
        expect(slot.style.willChange).toBe("");
        expect(slot.style.transform).toBe("");
        expect(slot.style.contain).toBe("paint");
    });

    it("the deck builder tile does not promote its face, editable or read-only", () => {
        for (const readOnly of [false, true]) {
            const { container, unmount } = render(
                <DragDropProvider>
                    <DeckCardTile
                        cardId={BOLT_ID}
                        dragId="a"
                        dragData={{ cardId: BOLT_ID } as CardDragData}
                        title="tile"
                        onClick={() => {}}
                        readOnly={readOnly}
                    />
                </DragDropProvider>
            );
            const slot = slotOf(container);
            expect(slot.style.willChange).toBe("");
            expect(slot.style.transform).toBe("");
            expect(slot.style.contain).toBe("paint");
            unmount();
        }
    });
});
