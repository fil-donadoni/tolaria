import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import LibraryOrderPicker from "../library-order-picker";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import {
    fitTileWidth,
    MODAL_CHROME_PADDING_X,
} from "~/lib/reorder-strip-width";
import { computeLayout } from "../layout";
import { CARD_W as CARD_W_NATURAL, MIN_CARD_W } from "../constants";

const looked = [
    { instanceId: "a", defId: "def-a" },
    { instanceId: "b", defId: "def-b" },
    { instanceId: "c", defId: "def-c" },
];

const looked5 = [
    { instanceId: "a", defId: "def-a" },
    { instanceId: "b", defId: "def-b" },
    { instanceId: "c", defId: "def-c" },
    { instanceId: "d", defId: "def-d" },
    { instanceId: "e", defId: "def-e" },
];

const setInnerWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: w,
    });
};

// Issue #315 — the picker reads `useMinimizedChoice` (minimize-to-board). The
// board mounts the real provider; these tests only need a no-op so the hook
// resolves. Mirrors the wrapper in player-graveyard / board-piles tests.
const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};
const renderPicker = (ui: ReactElement) =>
    render(
        <MinimizedChoiceContext value={noopMinimized}>
            {ui}
        </MinimizedChoiceContext>
    );

describe("LibraryOrderPicker", () => {
    // The touch-capture regression test below overwrites
    // `Element.prototype.{set,release,has}PointerCapture` globally (jsdom has
    // no real pointer-capture implementation to fake with). Save the originals
    // once and restore them after EVERY test in this file — not just the one
    // that mutates them — so a test appended later never inherits the mocked
    // prototype methods from a prior run.
    const proto = Element.prototype as Element & {
        setPointerCapture: unknown;
        releasePointerCapture: unknown;
        hasPointerCapture: unknown;
    };
    const originalSetPointerCapture = proto.setPointerCapture;
    const originalReleasePointerCapture = proto.releasePointerCapture;
    const originalHasPointerCapture = proto.hasPointerCapture;

    afterEach(() => {
        proto.setPointerCapture = originalSetPointerCapture;
        proto.releasePointerCapture = originalReleasePointerCapture;
        proto.hasPointerCapture = originalHasPointerCapture;
    });

    // Issue #1765 — the picker reads `window.innerWidth` (`useViewportWidth`)
    // to fit its tile width; restore the real value after every test so a
    // mobile-viewport test never leaks into a later one.
    const originalInnerWidth = window.innerWidth;
    afterEach(() => {
        setInnerWidth(originalInnerWidth);
    });

    it("confirming without dragging preserves the current top order and keeps everything on top", () => {
        // `lookedAt` is top-to-bottom (a = current top). No drag → the submit
        // must reproduce that order (topmost first) with nothing sent away.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"], []);
    });

    it("renders scry chrome for library-bottom", () => {
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("Bottom of library")).toBeTruthy();
        expect(getByText("Top of library")).toBeTruthy();
    });

    it("renders surveil chrome for graveyard", () => {
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="graveyard"
                prompt="Surveil"
                submitting={false}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("Graveyard")).toBeTruthy();
        expect(getByText("Top of library")).toBeTruthy();
    });

    it("order-only (none) shows a single top label and submits an empty second list", () => {
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Ponder"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        expect(getByText("Top of library")).toBeTruthy();
        fireEvent.click(getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"], []);
    });

    it("does not fire onConfirm while a submission is in flight", () => {
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={true}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(getByText("Done"));
        expect(onConfirm).not.toHaveBeenCalled();
    });

    // distribute mode (Impulse / Stock Up): HAND (right) / BOTTOM (left).
    it("renders HAND/BOTTOM chrome in distribute mode", () => {
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Impulse"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("Bottom of library")).toBeTruthy();
        expect(getByText("Your hand")).toBeTruthy();
    });

    // issue #1101 (Reviving Vapors) — `digToHand`'s `destination: "graveyard"`
    // reuses distribute mode but the un-kept pile is the GRAVEYARD, not the
    // library bottom. The chrome must follow `destination` here too (it used
    // to be hardcoded to "BOTTOM" regardless of the prop).
    it("renders HAND/GRAVEYARD chrome in distribute mode with destination graveyard", () => {
        const { getByText, queryByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="graveyard"
                prompt="Reviving Vapors"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("Graveyard")).toBeTruthy();
        expect(getByText("Your hand")).toBeTruthy();
        expect(queryByText("Bottom of library")).toBeNull();
    });

    it("distribute mode gates Done until exactly `keep` cards are in the HAND zone", () => {
        // Every card starts in the BOTTOM zone (hand is empty), so with keep = 1
        // the Done button is disabled and clicking it must not submit an illegal
        // (zero-to-hand) selection.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Impulse"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(true);
        fireEvent.click(done);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("optional distribute (Narset, min 0) lets Done submit with an empty HAND", () => {
        // Narset's −2 is a "you may": min 0, keep 1. Every card starts in the
        // BOTTOM zone; with the optional floor the player may confirm taking
        // nothing (submits an empty hand list).
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Narset"
                submitting={false}
                distribute={{ keep: 1, min: 0 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(false);
        fireEvent.click(done);
        // Empty hand → the second (bottom) list holds every looked-at card.
        expect(onConfirm).toHaveBeenCalledWith([], ["a", "b", "c"]);
    });

    // putBack mode (Brainstorm, CR 401.4): HAND (left, pool) / TOP OF LIBRARY
    // (right, exactly `keep` on top). Cards start in the HAND zone.
    it("renders HAND / TOP OF LIBRARY chrome in putBack mode", () => {
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Brainstorm"
                submitting={false}
                putBack={{ keep: 2 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("Your hand")).toBeTruthy();
        expect(getByText("Top of library")).toBeTruthy();
    });

    it("putBack mode gates Done until exactly `keep` cards are on top", () => {
        // Every card starts in the HAND (left) zone; with keep = 2 and nothing
        // placed on top yet, Done is disabled and must not submit.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Brainstorm"
                submitting={false}
                putBack={{ keep: 2 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(true);
        fireEvent.click(done);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    // Ranged put-back (Sylvan Library's `rangedTopdeck`, CR 118.4, issue
    // #1691): `min` 0 means "put none back and pay life for both" is legal, so
    // Done is enabled with an empty top zone — and the top zone still accepts
    // up to `keep`.
    it("putBack mode with min 0 allows submitting an empty top zone", () => {
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Sylvan Library"
                submitting={false}
                putBack={{ keep: 2, min: 0 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(false);
        fireEvent.click(done);
        expect(onConfirm).toHaveBeenCalledWith([], ["a", "b", "c"]);
    });

    // Mobile drag regression: a touch pointerdown gives the pressed CARD
    // implicit pointer capture, so the picker's first setPointerCapture on the
    // strip container transfers it and `lostpointercapture` fires on the card,
    // bubbling to the container. That transfer must NOT end the drag — it used
    // to commit() on the first move, snapping the card back ("card jumps away"
    // on phones). The spurious bubbled event here reproduces the transfer; the
    // drag must survive it and the release must still apply the reorder.
    it("a card→container capture transfer does not kill an active drag (touch)", () => {
        proto.setPointerCapture = vi.fn();
        proto.releasePointerCapture = vi.fn();
        proto.hasPointerCapture = vi.fn(() => true);

        const onConfirm = vi.fn();
        const { getByText, baseElement } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Portent"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        // DOM order follows `lookedAt` ([a, b, c]) — VISUAL order is the top
        // array [c, b, a] via transforms, so cards[0] ("a") is the rightmost
        // (top) card. Dragging it to the far left must reorder.
        const cards = baseElement.querySelectorAll(".cursor-grab");
        expect(cards.length).toBe(3);
        const rightmost = cards[0] as HTMLElement;
        const strip = rightmost.parentElement as HTMLElement;

        // Press the top card, drag it past the activation threshold…
        fireEvent.pointerDown(rightmost, {
            pointerId: 1,
            button: 0,
            clientX: 300,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 280,
            clientY: 50,
        });
        // …the implicit-capture transfer fires lostpointercapture ON THE CARD
        // (target ≠ container). Pre-fix this committed and ended the drag.
        fireEvent.lostPointerCapture(rightmost, { pointerId: 1 });
        // The drag is still alive: keep moving to the far LEFT and release.
        fireEvent.pointerMove(strip, { pointerId: 1, clientX: 0, clientY: 50 });
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 0, clientY: 50 });

        fireEvent.click(getByText("Done"));
        // "a" moved off the rightmost (top) slot — the no-drag submit would be
        // ["a", "b", "c"]; the survived drag lands it elsewhere.
        expect(onConfirm).toHaveBeenCalledTimes(1);
        const submittedTop = onConfirm.mock.calls[0][0] as string[];
        expect(submittedTop).not.toEqual(["a", "b", "c"]);
        expect([...submittedTop].sort()).toEqual(["a", "b", "c"]);
    });

    // Issue #1765 — a 5-card scry strip at the natural CARD_W overflows a
    // 390px phone viewport. The picker must shrink its tile width to the SAME
    // fit `fitTileWidth` computes (mirrored here rather than hardcoding a
    // pixel number, so this test tracks the real component math, not a
    // snapshot of it) — and its horizontal-scroll fallback must stay in place
    // regardless, satisfying "fully visible OR obviously scrollable".
    it("shrinks the tile width to fit a 5-card strip at a 390px mobile viewport", () => {
        setInnerWidth(390);
        const { baseElement } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked5}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={vi.fn()}
            />
        );

        // Mirrors the picker's own fit for this exact mount: scry mode starts
        // with an empty second (bottom) zone (reserved slot) and all 5 cards
        // on top.
        const expectedCardW = fitTileWidth({
            stripWidthAt: (w) =>
                computeLayout(0, 5, true, false, false, w).stripW,
            naturalTileW: CARD_W_NATURAL,
            minTileW: MIN_CARD_W,
            availableWidth: 390 - MODAL_CHROME_PADDING_X,
        });
        expect(expectedCardW).toBeLessThan(CARD_W_NATURAL);

        const cards = baseElement.querySelectorAll(".cursor-grab");
        expect(cards.length).toBe(5);
        for (const card of cards) {
            expect((card as HTMLElement).style.width).toBe(
                `${expectedCardW}px`
            );
        }

        // The strip's own horizontal-scroll fallback (issue #1765) stays
        // available even after shrinking, for whatever the fit can't fit.
        const scrollWrapper = baseElement.querySelector(".overflow-x-auto");
        expect(scrollWrapper).not.toBeNull();
    });

    // Issue #1765 — the touch drag-capture regression (above) must keep
    // working when the tile size is the RESPONSIVE (shrunk) one, not just the
    // natural desktop size — the gesture math (slot centers, drop index,
    // grabOffsetX) must follow the dynamic width.
    it("drag-to-reorder still works at a reduced tile size on touch (390px viewport)", () => {
        setInnerWidth(390);
        proto.setPointerCapture = vi.fn();
        proto.releasePointerCapture = vi.fn();
        proto.hasPointerCapture = vi.fn(() => true);

        const onConfirm = vi.fn();
        const { getByText, baseElement } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Portent"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        const cards = baseElement.querySelectorAll(".cursor-grab");
        expect(cards.length).toBe(3);
        const rightmost = cards[0] as HTMLElement;
        const strip = rightmost.parentElement as HTMLElement;

        fireEvent.pointerDown(rightmost, {
            pointerId: 1,
            button: 0,
            clientX: 300,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 280,
            clientY: 50,
        });
        fireEvent.lostPointerCapture(rightmost, { pointerId: 1 });
        fireEvent.pointerMove(strip, { pointerId: 1, clientX: 0, clientY: 50 });
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 0, clientY: 50 });

        fireEvent.click(getByText("Done"));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        const submittedTop = onConfirm.mock.calls[0][0] as string[];
        expect(submittedTop).not.toEqual(["a", "b", "c"]);
        expect([...submittedTop].sort()).toEqual(["a", "b", "c"]);
    });
});
