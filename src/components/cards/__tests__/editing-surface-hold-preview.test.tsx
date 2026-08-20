// The producer census, made executable (PRD #2405 gesture model A, issue
// #2583).
//
// `holdPreview` is a prop, so the interesting question is never "does the
// switch work" (`card-preview-hold-preview.test.tsx` answers that) but "did
// every surface that had to flip it actually flip it, and did no surface flip
// it that must not". That is a census, and a census is only checkable one row
// at a time — which is what this file is: one `it` per row of the table in the
// PR description, INCLUDING the must-NOT rows.
//
// Each row renders the REAL surface component in whatever context it needs and
// drives a REAL touch long-press, rather than grepping the source for the
// prop: a tile that passes `holdPreview={false}` to a CardImage it no longer
// renders would pass a grep and fail a user.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import DeckCardTile from "~/components/deckbuilder/deck-card-tile";
import LimitedDraftPackCard from "~/components/limited/limited-draft-pack-card";
import CardPreview from "../card-preview";
import CardImage from "../card-image";
import { resetPreviewSingleton } from "../card-preview-singleton";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

/** Past `useLongPress`' 400ms threshold — on any surface that still HAS the
 *  gesture, the centered overlay is up by now. */
const PAST_LONG_PRESS_MS = 500;

const overlay = () => document.querySelector(".fixed.inset-0");

/** `CardPreview` installs its touch listeners on its OWN wrapper div (or an
 *  enclosing `[data-card-tilt-root]`), which sits at a different depth in each
 *  surface's markup and carries no marker of its own. Touching every div in
 *  the tree reaches it wherever it is, and is safe precisely because only that
 *  one element has a listener bound — pressing the others is a no-op. */
function longPressEverything(container: HTMLElement) {
    act(() => {
        for (const el of container.querySelectorAll("div")) {
            fireEvent.touchStart(el, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        }
        vi.advanceTimersByTime(PAST_LONG_PRESS_MS);
    });
}

const DRAG_DATA: CardDragData = {
    kind: "main",
    cardId: BOLT_ID,
    cardName: "Lightning Bolt",
};

describe("editing-surface hold-preview census (issue #2583)", () => {
    beforeEach(() => {
        resetPreviewSingleton();
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        resetPreviewSingleton();
    });

    // ---- rows that MUST route through the new model (hold = drag) ----

    it("deckbuilder tile: a long press opens no preview", () => {
        const { container } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="d1"
                    dragData={DRAG_DATA}
                    title="Remove Lightning Bolt"
                    onClick={() => {}}
                />
            </DragDropProvider>
        );
        longPressEverything(container);
        expect(overlay()).toBeNull();
    });

    it("Draft Room pack card: a long press opens no preview", () => {
        const { container } = render(
            <LimitedDraftPackCard
                card={{
                    scryfallId: "s1",
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                    pickId: "r0-p0-c0",
                }}
                selected={false}
                onSelect={vi.fn()}
                onPick={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        longPressEverything(container);
        expect(overlay()).toBeNull();
    });

    // ---- the must-NOT row: everything else keeps ADR 0009 ----
    //
    // The board is the reason `holdPreview` defaults to TRUE rather than being
    // opted INTO. A default of false would silently strip the long-press
    // preview from ~30 board surfaces, none of which this issue touches, and
    // no test of the editing surfaces alone would notice.
    it("a plain CardImage (board, piles, lobby) still opens the preview on hold", () => {
        const { container } = render(
            <CardPreview cardId="bolt" cardName="Lightning Bolt">
                <CardImage card={{ id: BOLT_ID }} />
            </CardPreview>
        );
        longPressEverything(container);
        expect(overlay()).toBeTruthy();
    });
});
