// Booster pick gestures (ADR 0060, issue #1248; re-worked for the desktop
// card-context-menu regime by issue #2861, partially reverted by issue
// #2889). Load-bearing: a single click must NEVER commit a Pick — only
// select (and, on desktop, open the menu right there). Double-click commits
// on PHONE only — desktop retires it, since the menu already carries "Pick"
// and drag-and-drop still works. Real right-click opens the phone's old menu
// — desktop has NO handler at all (issue #2889): it falls through to the
// app's ordinary `CardPreview` pin, same as everywhere else.
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

describe("LimitedDraftPackCard gestures — phone regime (onPick/onOpenContextMenu, unchanged)", () => {
    it("a single click SELECTS the card and NEVER calls onPick", () => {
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenContextMenu={vi.fn()}
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
                onOpenContextMenu={vi.fn()}
                pending={false}
            />
        );
        fireEvent.doubleClick(getByRole("button"));
        expect(onPick).toHaveBeenCalledWith("r0-p0-c0");
    });

    it("a right click opens the context menu instead of the browser's native one, and never selects or commits", () => {
        const onOpenContextMenu = vi.fn();
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenContextMenu={onOpenContextMenu}
                pending={false}
            />
        );
        fireEvent.contextMenu(getByRole("button"), {
            clientX: 12,
            clientY: 34,
        });
        expect(onOpenContextMenu).toHaveBeenCalledWith("r0-p0-c0", 12, 34);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onPick).not.toHaveBeenCalled();
    });

    it("while pending, a click/double-click/right-click all no-op", () => {
        const onSelect = vi.fn();
        const onPick = vi.fn();
        const onOpenContextMenu = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onPick={onPick}
                onOpenContextMenu={onOpenContextMenu}
                pending
            />
        );
        const el = getByRole("button");
        fireEvent.click(el);
        fireEvent.doubleClick(el);
        fireEvent.contextMenu(el);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onPick).not.toHaveBeenCalled();
        expect(onOpenContextMenu).not.toHaveBeenCalled();
    });
});

describe("LimitedDraftPackCard gestures — desktop regime (onOpenMenu, issue #2861)", () => {
    it("a single click SELECTS the card AND opens the pack menu right there, no delay", () => {
        const onSelect = vi.fn();
        const onOpenMenu = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onOpenMenu={onOpenMenu}
                pending={false}
            />
        );
        fireEvent.click(getByRole("button"), { clientX: 12, clientY: 34 });
        expect(onSelect).toHaveBeenCalledWith("r0-p0-c0");
        expect(onOpenMenu).toHaveBeenCalledWith("r0-p0-c0", 12, 34);
    });

    it("has no double-click action at all — double-click-to-pick is retired on this regime", () => {
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        // No `onDoubleClick` handler bound at all — firing the event must not
        // throw, and there is nothing to assert it called (no `onPick` prop
        // even exists to spy on).
        expect(() => fireEvent.doubleClick(getByRole("button"))).not.toThrow();
    });

    // Issue #2889: reverts the desktop right-click-opens-Inspect-Overlay
    // behavior issue #2861 added — a real right-click here is untouched by
    // this component (no `onContextMenu` prop exists to intercept it at
    // all), so it falls through to `CardImage`'s own `CardPreview` pin,
    // same as everywhere else in the app.
    it("a real right click is left entirely alone — no menu, no overlay, no selection", () => {
        const onOpenMenu = vi.fn();
        const onSelect = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onOpenMenu={onOpenMenu}
                pending={false}
            />
        );
        expect(() => fireEvent.contextMenu(getByRole("button"))).not.toThrow();
        expect(onOpenMenu).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("while pending, a click/double-click all no-op", () => {
        const onSelect = vi.fn();
        const onOpenMenu = vi.fn();
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={onSelect}
                onOpenMenu={onOpenMenu}
                pending
            />
        );
        const el = getByRole("button");
        fireEvent.click(el);
        fireEvent.doubleClick(el);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onOpenMenu).not.toHaveBeenCalled();
    });
});

describe("LimitedDraftPackCard visuals (regime-independent)", () => {
    it("renders a selected highlight when selected is true", () => {
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected
                onSelect={vi.fn()}
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
                pending={false}
            />
        );
        const tile = getByRole("button");
        const ring = getByTestId("selection-ring");
        const art = getByAltText("Lightning Bolt");

        // The ring carries the shared INSET card-ring recipe (#2724) at the
        // pack card's own 4px weight...
        expect(ring.className).toContain("card-ring ");
        expect(ring.className).toContain("card-ring-selected");
        expect(ring.className).toContain("[--card-ring-w:4px]");

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
                pending={false}
            />
        );
        expect(queryByTestId("selection-ring")).toBeNull();
    });

    it("permits native vertical panning instead of blocking all touch (issue #2664)", () => {
        // `touch-none` forecloses the browser's OWN scroll gesture at
        // `touchstart`, before dnd-kit's touch `Delay` constraint ever gets a
        // chance to run — a vertical drag starting on a tile could never
        // scroll the phone pack grid (`limited-draft-pack.tsx`), stranding
        // cards past the fold at the `dense` rung. `touch-pan-y` is the fix:
        // the browser may still pan vertically (a quick swipe scrolls); only
        // a stationary hold reaches dnd-kit's Delay timer and starts a drag.
        // happy-dom cannot arbitrate scroll-vs-drag itself (no layout, no
        // real touch-action enforcement) — this asserts the CSS declaration
        // the browser acts on, which is the only thing a unit test CAN prove
        // here. The actual scroll-vs-drag-vs-tap decision for this surface is
        // dnd-kit's own `PointerSensor` + `Delay` constraint
        // (`useDeckDragSensors.ts`), not the in-repo `gestureReducer`
        // (`src/lib/gesture/activation.ts`) — that reducer backs the OTHER,
        // custom-engine gesture surfaces (board hand, deckbuilder tiles use
        // dnd-kit too) and never runs on this component, so it is not the
        // place to add coverage for this bug. The real proof is the browser
        // receipt (`bun run check:ui` + a manual CDP walk at the `dense`
        // rung, per the PR).
        const { getByRole } = render(
            <LimitedDraftPackCard
                card={card}
                selected={false}
                onSelect={vi.fn()}
                pending={false}
            />
        );
        const tile = getByRole("button");
        expect(tile.className).toContain("touch-pan-y");
        expect(tile.className).not.toContain("touch-none");
    });
});
