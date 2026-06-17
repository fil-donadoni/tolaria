// Slice #255 (PRD #249): inertial (Arena-like) scrolling for overflowing piles
// / zones must ADD a pointer-drag affordance WITHOUT regressing native
// keyboard accessibility or focus. These tests assert external behavior on a
// real DOM node: a drag pans scrollLeft, a real drag suppresses the click that
// would otherwise activate a card, a plain click passes through, presses on
// focusable children are ignored (so they stay keyboard-operable), and wheel /
// key events are never preventDefaulted.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useInertialScroll } from "../useInertialScroll";

function Strip({ onCardClick }: { onCardClick?: () => void }) {
    const ref = useInertialScroll<HTMLDivElement>("x");
    return (
        <div
            ref={ref}
            data-testid="strip"
            tabIndex={0}
            style={{ overflowX: "auto", width: 100 }}
        >
            <button type="button" data-testid="card" onClick={onCardClick}>
                card
            </button>
            <div style={{ width: 1000 }}>wide</div>
        </div>
    );
}

beforeEach(() => cleanup());

// jsdom doesn't lay out, so seed a scrollable extent manually.
function makeScrollable(el: HTMLElement) {
    Object.defineProperty(el, "scrollWidth", {
        value: 1000,
        configurable: true,
    });
    Object.defineProperty(el, "clientWidth", {
        value: 100,
        configurable: true,
    });
    el.scrollLeft = 200;
}

describe("useInertialScroll (slice #255)", () => {
    it("pans scrollLeft when dragging the strip background", () => {
        const { getByTestId } = render(<Strip />);
        const strip = getByTestId("strip");
        makeScrollable(strip);
        strip.setPointerCapture = vi.fn();
        strip.hasPointerCapture = () => false;

        fireEvent.pointerDown(strip, {
            pointerId: 1,
            button: 0,
            clientX: 80,
            clientY: 0,
        });
        // Move left by 30px past the drag threshold → content pans right.
        fireEvent.pointerMove(strip, { pointerId: 1, clientX: 50, clientY: 0 });
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 50, clientY: 0 });

        // scrollLeft -= dx, dx = 50 - 80 = -30 → scrollLeft increases by 30.
        expect(strip.scrollLeft).toBe(230);
    });

    it("suppresses the click on a card after a real drag (no accidental cast)", () => {
        const onCardClick = vi.fn();
        const { getByTestId } = render(<Strip onCardClick={onCardClick} />);
        const strip = getByTestId("strip");
        makeScrollable(strip);
        strip.setPointerCapture = vi.fn();
        strip.hasPointerCapture = () => false;
        const card = getByTestId("card");

        // A press that starts on the background but drags past the card.
        fireEvent.pointerDown(strip, {
            pointerId: 1,
            button: 0,
            clientX: 80,
            clientY: 0,
        });
        fireEvent.pointerMove(strip, { pointerId: 1, clientX: 40, clientY: 0 });
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 40, clientY: 0 });
        // The browser fires a click on release; the hook's capture handler eats it.
        fireEvent.click(card);

        expect(onCardClick).not.toHaveBeenCalled();
    });

    it("lets a plain click (no drag) through to the card", () => {
        const onCardClick = vi.fn();
        const { getByTestId } = render(<Strip onCardClick={onCardClick} />);
        const strip = getByTestId("strip");
        makeScrollable(strip);
        const card = getByTestId("card");

        // pointerdown begins on the interactive child → panning is not armed,
        // and a normal click reaches the handler.
        fireEvent.pointerDown(card, {
            pointerId: 1,
            button: 0,
            clientX: 10,
            clientY: 0,
        });
        fireEvent.pointerUp(card, { pointerId: 1, clientX: 10, clientY: 0 });
        fireEvent.click(card);

        expect(onCardClick).toHaveBeenCalledTimes(1);
    });

    it("does not pan when the press starts on a focusable child (keyboard stays operable)", () => {
        const { getByTestId } = render(<Strip />);
        const strip = getByTestId("strip");
        makeScrollable(strip);
        const card = getByTestId("card");

        fireEvent.pointerDown(card, {
            pointerId: 1,
            button: 0,
            clientX: 80,
            clientY: 0,
        });
        fireEvent.pointerMove(strip, { pointerId: 1, clientX: 20, clientY: 0 });
        fireEvent.pointerUp(strip, { pointerId: 1, clientX: 20, clientY: 0 });

        // Press on the button is ignored, so nothing pans.
        expect(strip.scrollLeft).toBe(200);
    });

    it("keeps the strip natively focusable and never blocks wheel/key events", () => {
        const { getByTestId } = render(<Strip />);
        const strip = getByTestId("strip") as HTMLDivElement;
        // Native keyboard scroll relies on the element being focusable.
        expect(strip.tabIndex).toBe(0);

        // The hook must not preventDefault wheel/keydown (would break native
        // trackpad + arrow-key scrolling).
        const wheel = new Event("wheel", { cancelable: true });
        strip.dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(false);

        const key = new KeyboardEvent("keydown", {
            key: "ArrowRight",
            cancelable: true,
        });
        strip.dispatchEvent(key);
        expect(key.defaultPrevented).toBe(false);
    });
});
