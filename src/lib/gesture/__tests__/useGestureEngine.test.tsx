// The MOUNTED half of the gesture engine (PRD #2405, issue #2583).
//
// `activation.test.ts` proves the pure decision core. This file proves the
// plumbing the core cannot contain — the 250ms timer, the ghost, the
// `elementFromPoint` drop resolution and the window-level pointer listeners —
// by driving REAL pointer events at a REAL mounted surface and asserting the
// surface's own callbacks fire.
//
// happy-dom has no layout, so `document.elementFromPoint` hit-tests nothing.
// The stub below is the ONLY faked link: it maps an x-coordinate to a drop
// region exactly as a layout engine would, and everything else — the reducer,
// the timer, `dropIdAt`'s `closest()` walk, the ghost's `data-over` — is real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import DragGhost from "~/components/editing/drag-ghost";
import { dropTargetProps } from "../drop-targets";
import {
    MOUSE_DRAG_DISTANCE_PX,
    TOUCH_HOLD_MS,
    TOUCH_MOVE_TOLERANCE_PX,
} from "../activation";
import {
    useGestureEngine,
    type GestureEngineOptions,
} from "../useGestureEngine";

/** A minimal editing surface: one draggable card, two `[data-drop]` regions.
 *  The nested `<span>` inside each region is what the stub returns, so the
 *  test also exercises `dropIdAt`'s walk UP to the nearest `[data-drop]`
 *  ancestor rather than assuming the hit element carries the attribute. */
function Surface(options: GestureEngineOptions) {
    const engine = useGestureEngine(options);
    return (
        <div>
            <div data-testid="card" {...engine.cardProps("bolt")}>
                face
            </div>
            <div {...dropTargetProps("maindeck")}>
                <span data-testid="hit-maindeck">maindeck</span>
            </div>
            <div {...dropTargetProps("sideboard")}>
                <span data-testid="hit-sideboard">sideboard</span>
            </div>
            <div data-testid="hit-nowhere">not a drop region</div>
            {engine.drag && <DragGhost drag={engine.drag} cardId="bolt" />}
        </div>
    );
}

/** x < 100 → maindeck · x < 200 → sideboard · otherwise no drop region. */
function installHitTest() {
    (
        document as unknown as {
            elementFromPoint: (x: number) => Element | null;
        }
    ).elementFromPoint = (x: number) =>
        x < 100
            ? document.querySelector('[data-testid="hit-maindeck"]')
            : x < 200
              ? document.querySelector('[data-testid="hit-sideboard"]')
              : document.querySelector('[data-testid="hit-nowhere"]');
}

function handlers() {
    return {
        onSelect: vi.fn(),
        onMove: vi.fn(),
        onDragStart: vi.fn(),
        onDragCancel: vi.fn(),
        onScroll: vi.fn(),
    };
}

const ghost = () => document.querySelector("[data-drag-ghost]");

function press(el: Element, x: number, y: number, pointerType = "touch") {
    act(() => {
        fireEvent.pointerDown(el, {
            button: 0,
            pointerId: 1,
            pointerType,
            clientX: x,
            clientY: y,
        });
    });
}

function move(x: number, y: number) {
    act(() => {
        fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y });
    });
}

function release(x: number, y: number) {
    act(() => {
        fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });
    });
}

function hold() {
    act(() => {
        vi.advanceTimersByTime(TOUCH_HOLD_MS);
    });
}

describe("useGestureEngine — mounted surface (issue #2583)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installHitTest();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("tap without movement selects the card (→ Peek Panel) and never drags", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        const card = getByTestId("card");

        press(card, 50, 50);
        release(50, 50);

        expect(h.onSelect).toHaveBeenCalledWith("bolt");
        expect(h.onDragStart).not.toHaveBeenCalled();
        expect(ghost()).toBeNull();
    });

    it("long-press raises a ghost, and dropping it on a [data-drop] region fires the surface callback", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        const card = getByTestId("card");

        press(card, 150, 50);
        expect(ghost()).toBeNull();
        hold();

        // The ghost exists the instant the hold fires — before any movement.
        expect(ghost()).toBeTruthy();
        expect(h.onDragStart).toHaveBeenCalledWith("bolt");

        // Drag left, over the maindeck region: the ghost reports what it is over.
        move(40, 60);
        expect(ghost()!.getAttribute("data-over")).toBe("maindeck");
        move(150, 60);
        expect(ghost()!.getAttribute("data-over")).toBe("sideboard");

        release(150, 60);
        expect(h.onMove).toHaveBeenCalledWith("bolt", "sideboard");
        expect(h.onDragCancel).not.toHaveBeenCalled();
        expect(ghost()).toBeNull();
    });

    it("dropping on nothing cancels the drag instead of moving the card", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        press(getByTestId("card"), 50, 50);
        hold();
        move(400, 50);
        release(400, 50);

        expect(h.onMove).not.toHaveBeenCalled();
        expect(h.onDragCancel).toHaveBeenCalledWith("bolt");
    });

    it("a 12px move at 100ms is a scroll: no drag, no ghost, and no tap on release", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        press(getByTestId("card"), 50, 50);

        act(() => {
            vi.advanceTimersByTime(100);
        });
        move(50, 62); // 12px > TOUCH_MOVE_TOLERANCE_PX, before the timer
        // The timer must be DEAD, not merely losing a race: let it elapse.
        act(() => {
            vi.advanceTimersByTime(TOUCH_HOLD_MS);
        });

        expect(h.onScroll).toHaveBeenCalledWith("bolt");
        expect(h.onDragStart).not.toHaveBeenCalled();
        expect(ghost()).toBeNull();

        release(50, 62);
        // A press the browser scrolled is not also a tap — it must not open
        // the Peek Panel under the finger the user just swiped with.
        expect(h.onSelect).not.toHaveBeenCalled();
    });

    it("jitter under the tolerance still becomes a drag when the timer fires", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        press(getByTestId("card"), 50, 50);
        move(50, 50 + TOUCH_MOVE_TOLERANCE_PX);
        hold();

        expect(h.onDragStart).toHaveBeenCalledWith("bolt");
        expect(h.onScroll).not.toHaveBeenCalled();
    });

    it("a mouse drags past the distance threshold without waiting for any hold", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        press(getByTestId("card"), 150, 50, "mouse");

        move(150 + MOUSE_DRAG_DISTANCE_PX, 50);
        expect(h.onDragStart).not.toHaveBeenCalled();

        move(150 + MOUSE_DRAG_DISTANCE_PX + 1, 50);
        expect(h.onDragStart).toHaveBeenCalledWith("bolt");
        expect(ghost()).toBeTruthy();
        // No timer was ever needed — the drag is live at 0ms.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("pointercancel mid-drag ends the drag without moving the card", () => {
        const h = handlers();
        const { getByTestId } = render(<Surface {...h} />);
        press(getByTestId("card"), 50, 50);
        hold();
        act(() => {
            fireEvent.pointerCancel(window, { pointerId: 1 });
        });

        expect(h.onDragCancel).toHaveBeenCalledWith("bolt");
        expect(h.onMove).not.toHaveBeenCalled();
        expect(ghost()).toBeNull();
    });

    it("unmounting mid-drag removes the non-passive touchmove blocker", () => {
        const remove = vi.spyOn(document, "removeEventListener");
        const h = handlers();
        const { getByTestId, unmount } = render(<Surface {...h} />);
        press(getByTestId("card"), 50, 50);
        hold();

        unmount();

        // Leaving it installed would make every later touch in the app
        // unscrollable — the worst failure this engine can ship.
        expect(remove).toHaveBeenCalledWith("touchmove", expect.any(Function));
    });
});
