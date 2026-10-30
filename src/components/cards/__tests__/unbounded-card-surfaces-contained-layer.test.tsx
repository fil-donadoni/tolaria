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
 * Every printed face renders CONTAINED, never promoted to its own compositor
 * layer (issue #6940, issue #7590).
 *
 * Two measured costs of a promoted face. A `will-change` layer is rastered
 * once, at the scale its ancestors have then: inside a dialog opening with
 * `zoom-in-95` it stays soft for good (issue #7590 — `check:ui` reds that
 * one). And under a starved GPU budget promoted faces are evicted to blank
 * slots (issue #6940) — which `check:ui` sees only when the budget is
 * starved, so the lane cannot red a pack tile that goes back to promoting.
 * Measured 2026-10-29 with
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

describe("printed faces render contained, never promoted (issue #6940, issue #7590)", () => {
    it("CardImage's face is contained: no compositor hint, no forced layer", () => {
        const { container } = render(<CardImage card={{ id: BOLT_ID }} />);
        const slot = slotOf(container);
        expect(slot.style.willChange).toBe("");
        expect(slot.style.transform).toBe("");
        expect(slot.style.contain).toBe("paint");
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
