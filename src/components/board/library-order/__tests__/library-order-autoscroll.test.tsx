import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { ReactElement } from "react";
import LibraryOrderPicker from "../library-order-picker";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { fitTileWidth, modalChromePaddingX } from "~/lib/reorder-strip-width";
import { computeLayout } from "../layout";
import { CARD_W as CARD_W_NATURAL, MIN_CARD_W } from "../constants";

// Issue #9813 — large reorders: natural-size tiles on desktop/tablet, and edge
// auto-scroll while dragging so one gesture moves a card end to end.

const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        instanceId: `c${i}`,
        defId: `def-${i}`,
    }));

const setInnerWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: w,
    });
};

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

/** happy-dom has no layout: give the strip's scroll container a real
 *  scroll extent and make both rects follow `scrollLeft`, the way a browser
 *  does — the strip container sits `pad` px into the scroller's content. */
function rigScroll(
    strip: HTMLElement,
    opts: { visible: number; scrollWidth: number; start: number; pad: number }
): HTMLElement {
    const scroller = strip.parentElement as HTMLElement;
    let left = opts.start;
    Object.defineProperty(scroller, "scrollLeft", {
        configurable: true,
        get: () => left,
        set: (v: number) => {
            left = v;
        },
    });
    Object.defineProperty(scroller, "scrollWidth", {
        configurable: true,
        value: opts.scrollWidth,
    });
    Object.defineProperty(scroller, "clientWidth", {
        configurable: true,
        value: opts.visible,
    });
    scroller.getBoundingClientRect = () =>
        ({
            left: 0,
            right: opts.visible,
            top: 0,
            bottom: 300,
            width: opts.visible,
            height: 300,
        }) as DOMRect;
    strip.getBoundingClientRect = () =>
        ({
            left: opts.pad - left,
            right: opts.pad - left + opts.scrollWidth,
            top: 0,
            bottom: 200,
            width: opts.scrollWidth,
            height: 200,
        }) as DOMRect;
    return scroller;
}

describe("LibraryOrderPicker — large reorders (issue #9813)", () => {
    const proto = Element.prototype as Element & {
        setPointerCapture: unknown;
        releasePointerCapture: unknown;
        hasPointerCapture: unknown;
    };
    const originals = {
        set: proto.setPointerCapture,
        release: proto.releasePointerCapture,
        has: proto.hasPointerCapture,
    };
    const originalInnerWidth = window.innerWidth;

    afterEach(() => {
        proto.setPointerCapture = originals.set;
        proto.releasePointerCapture = originals.release;
        proto.hasPointerCapture = originals.has;
        setInnerWidth(originalInnerWidth);
        vi.useRealTimers();
    });

    const mockCapture = () => {
        const set = vi.fn();
        const release = vi.fn();
        proto.setPointerCapture = set;
        proto.releasePointerCapture = release;
        proto.hasPointerCapture = vi.fn(() => true);
        return { set, release };
    };

    const renderGraveyard22 = (onConfirm = vi.fn()) =>
        renderPicker(
            <LibraryOrderPicker
                lookedAt={many(22)}
                destination="none"
                prompt="Arrange"
                submitting={false}
                graveyardOrder={{ onOrderRandomly: vi.fn() }}
                onConfirm={onConfirm}
            />
        );

    it.each([1440, 1180, 820])(
        "renders a 22-card graveyard strip at natural CARD_W at %ipx (desktop/tablet)",
        (w) => {
            setInnerWidth(w);
            const { baseElement } = renderGraveyard22();
            const cards = baseElement.querySelectorAll(".cursor-grab");
            expect(cards.length).toBe(22);
            for (const card of cards) {
                expect((card as HTMLElement).style.width).toBe(
                    `${CARD_W_NATURAL}px`
                );
            }
        }
    );

    it("keeps the phone fit + floor for the same strip at 390px", () => {
        setInnerWidth(390);
        const expected = fitTileWidth({
            stripWidthAt: (w) =>
                computeLayout(0, 22, false, false, false, w).stripW,
            naturalTileW: CARD_W_NATURAL,
            minTileW: MIN_CARD_W,
            availableWidth: 390 - modalChromePaddingX(390),
        });
        expect(expected).toBe(MIN_CARD_W);
        const { baseElement } = renderGraveyard22();
        for (const card of baseElement.querySelectorAll(".cursor-grab")) {
            expect((card as HTMLElement).style.width).toBe(`${expected}px`);
        }
    });

    // Geometry at 1440 (graveyardOrder = `none` layout, CARD_W 116): top zone
    // starts at 140, slot i centered at 198 + 60·i, strip 1516px wide. The
    // rig shows 600px of it, scrollable by 1000px.
    const RIG = { visible: 600, scrollWidth: 1600, pad: 40 };

    it("one gesture: second-to-last card held at the left edge scrolls to the start and lands first", () => {
        setInnerWidth(1440);
        vi.useFakeTimers({
            toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
        });
        const { release } = mockCapture();
        const onConfirm = vi.fn();
        const { baseElement, getByText } = renderGraveyard22(onConfirm);
        const cards = baseElement.querySelectorAll(".cursor-grab");
        // lookedAt is top-first and reversed into the fan, so c1 is the
        // second-to-last (slot 20) card.
        const card = cards[1] as HTMLElement;
        const strip = card.parentElement as HTMLElement;
        const scroller = rigScroll(strip, { ...RIG, start: 1000 });

        // Slot 20 center = 1398 strip-local → client 1398 + 40 − 1000 = 438.
        fireEvent.pointerDown(card, {
            pointerId: 1,
            button: 0,
            clientX: 438,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 430,
            clientY: 50,
        });
        // Into the left edge band, then hold still.
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 10,
            clientY: 50,
        });
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(scroller.scrollLeft).toBe(0);
        // Still the same gesture: no release, no commit yet.
        expect(release).not.toHaveBeenCalled();

        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 10, clientY: 50 });
        fireEvent.click(getByText("Done"));

        const rest = many(22)
            .map((c) => c.instanceId)
            .filter((id) => id !== "c1");
        // Topmost-first submit: c1 now sits leftmost = bottom of the pile.
        expect(onConfirm).toHaveBeenCalledWith([...rest, "c1"], []);
    });

    it("touch, reverse: first card held at the right edge scrolls to the end and lands last, capture kept", () => {
        setInnerWidth(1440);
        vi.useFakeTimers({
            toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
        });
        const { set, release } = mockCapture();
        const onConfirm = vi.fn();
        const { baseElement, getByText } = renderGraveyard22(onConfirm);
        const cards = baseElement.querySelectorAll(".cursor-grab");
        const card = cards[21] as HTMLElement; // c21 = slot 0, leftmost
        const strip = card.parentElement as HTMLElement;
        const scroller = rigScroll(strip, { ...RIG, start: 0 });

        // Slot 0 center = 198 → client 238.
        fireEvent.pointerDown(card, {
            pointerId: 1,
            pointerType: "touch",
            button: 0,
            clientX: 238,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            pointerType: "touch",
            clientX: 246,
            clientY: 50,
        });
        // The touch implicit-capture transfer (card → container).
        fireEvent.lostPointerCapture(card, { pointerId: 1 });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            pointerType: "touch",
            clientX: 590,
            clientY: 50,
        });
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(scroller.scrollLeft).toBe(1000);
        expect(set).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        // The dragged card is still live (no early commit).
        expect(card.style.transition).toBe("none");

        fireEvent.pointerUp(strip, {
            pointerId: 1,
            pointerType: "touch",
            clientX: 590,
            clientY: 50,
        });
        fireEvent.click(getByText("Done"));

        const rest = many(22)
            .map((c) => c.instanceId)
            .filter((id) => id !== "c21");
        expect(onConfirm).toHaveBeenCalledWith(["c21", ...rest], []);
    });

    it("two-zone (scry): a top card auto-scrolled past the library mock routes to the bottom zone", () => {
        setInnerWidth(1440);
        vi.useFakeTimers({
            toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
        });
        mockCapture();
        const onConfirm = vi.fn();
        const { baseElement, getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={many(12)}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        // Scry geometry at 116: library center 212, top zone from 270, the
        // top card (c0, slot 11) centered at 988; strip 1046px wide.
        const cards = baseElement.querySelectorAll(".cursor-grab");
        const card = cards[0] as HTMLElement;
        const strip = card.parentElement as HTMLElement;
        const scroller = rigScroll(strip, {
            visible: 400,
            scrollWidth: 1126,
            pad: 40,
            start: 726,
        });

        // 988 + 40 − 726 = 302.
        fireEvent.pointerDown(card, {
            pointerId: 1,
            button: 0,
            clientX: 302,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 294,
            clientY: 50,
        });
        fireEvent.pointerMove(strip, {
            pointerId: 1,
            clientX: 10,
            clientY: 50,
        });
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(scroller.scrollLeft).toBe(0);
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 10, clientY: 50 });
        fireEvent.click(getByText("Done"));

        const rest = many(12)
            .map((c) => c.instanceId)
            .filter((id) => id !== "c0");
        expect(onConfirm).toHaveBeenCalledWith(rest, ["c0"]);
    });
});
