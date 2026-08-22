// Booster pick gestures (ADR 0060, issue #1248). Load-bearing: a single
// click must NEVER commit a Pick — only select. Double-click / the
// context-menu action commit. Right-click opens the menu instead of the
// browser's native one.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import LimitedDraftPackCard from "../limited-draft-pack-card";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

const card = {
    scryfallId: "s1",
    cardId: BOLT_ID,
    cardName: "Lightning Bolt",
    pickId: "r0-p0-c0",
};

afterEach(() => cleanup());

describe("LimitedDraftPackCard gestures (ADR 0060, issue #1248)", () => {
    it("a single click SELECTS the card and NEVER calls onPick", () => {
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        fireEvent.click(getByRole("button"));
        expect(onSelect).toHaveBeenCalledWith("r0-p0-c0");
        expect(onPick).not.toHaveBeenCalled();
    });

    it("a double click commits the Pick", () => {
        const onPick = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={vi.fn()}
                onPick={onPick}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        fireEvent.doubleClick(getByRole("button"));
        expect(onPick).toHaveBeenCalledWith("r0-p0-c0");
    });

    it("a right click opens the context menu instead of the browser's native one, and never selects or commits", () => {
        const onOpenMenu = vi.fn();
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenMenu={onOpenMenu}
                pending={false}
            />
        );
        fireEvent.contextMenu(getByRole("button"), {
            clientX: 12,
            clientY: 34,
        });
        expect(onOpenMenu).toHaveBeenCalledWith("r0-p0-c0", 12, 34);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onPick).not.toHaveBeenCalled();
    });

    it("renders a selected highlight when selected is true", () => {
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected
                onSelect={vi.fn()}
                onPick={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        expect(getByRole("button").getAttribute("aria-pressed")).toBe("true");
    });

    it("draws the selected ring as a separate overlay PAINTED AFTER the card art (issue #2663)", () => {
        // The phone pack grid is itself the clipping scroller, flush against
        // its own edges with no padding — a ring drawn OUTSIDE the border
        // box (Tailwind's default) is clipped on every edge column/row, so
        // the ring is `ring-inset`. But an inset box-shadow on the TILE
        // ITSELF paints in that element's own box-decoration layer, BELOW
        // every descendant — and the card art (`CardImage`'s `<img>`) covers
        // the tile's box exactly, so an inset ring declared directly on the
        // tile is invisible (this is the bug a class-name-only assertion
        // cannot see: happy-dom has no paint order at all, so it stayed
        // green with the ring invisible in every real browser). The overlay
        // must therefore be its OWN element, and it must come AFTER the art
        // in DOM order — for two siblings in the same stacking context,
        // later-in-DOM paints on top, which is the structural fact that
        // actually makes the ring visible.
        const { getByRole, getByTestId, getByAltText } = render(
            <LimitedDraftPackCard
                card={card}
                selected
                onSelect={vi.fn()}
                onPick={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        const tile = getByRole("button");
        const ring = getByTestId("selection-ring");
        const art = getByAltText("Lightning Bolt");

        // The ring carries the inset ring utilities...
        expect(ring.className).toContain("ring-inset");
        expect(ring.className).toContain("ring-4");

        // ...on an element that is a DIRECT CHILD of the tile (a sibling of
        // the whole CardImage subtree, not nested inside its own
        // `overflow-hidden` art wrapper)...
        expect(ring.parentElement).toBe(tile);

        // ...and ordered AFTER the art in the DOM, which is what makes it
        // paint on top instead of underneath.
        expect(
            art.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("renders no selection-ring overlay when not selected", () => {
        const { queryByTestId } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={vi.fn()}
                onPick={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        expect(queryByTestId("selection-ring")).toBeNull();
    });

    it("while pending, a click/double-click/right-click all no-op", () => {
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const onOpenMenu = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenMenu={onOpenMenu}
                pending
            />
        );
        const el = getByRole("button");
        fireEvent.click(el);
        fireEvent.doubleClick(el);
        fireEvent.contextMenu(el);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onPick).not.toHaveBeenCalled();
        expect(onOpenMenu).not.toHaveBeenCalled();
    });
});
