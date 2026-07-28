// Grab-handle drag-to-close gesture (issue #1761). The handle used to be pure
// decoration — the sheet only closed via the X button (rendered inside
// `ControllerPhaseList`, already covered by controller-phase-list.test.tsx)
// or the backdrop. These tests cover the NEW pointer-capture drag: down on
// the handle → move past threshold → up closes past the dismiss line, springs
// back short of it, and survives the touch implicit-pointer-capture transfer
// trap this repo has hit (and fixed) twice before
// (library-order-picker.tsx / trigger-order-prompt.tsx).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// jsdom elements lack pointer-capture; stub so setPointerCapture/
// hasPointerCapture/releasePointerCapture are no-ops (same stub as
// board-hand-card.test.tsx). The one test that needs capture to actually
// report `true` (the touch capture-transfer regression) overrides
// `hasPointerCapture` itself.
beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

// `ControllerPhaseList` needs GameContext + SkipPhasePrefsContext to render
// its real content — irrelevant to the sheet SHELL's own gesture contract
// under test here, and already exercised by controller-phase-list.test.tsx.
// Stand it in with a stub that still exposes the X close button so the
// "X still works" contract stays checkable from this file too.
vi.mock("../controller-phase-list", () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <button type="button" aria-label="Close phase list" onClick={onClose}>
            phase list
        </button>
    ),
}));

const { default: ControllerPhaseSheet } =
    await import("../controller-phase-sheet");

function pressHandle(handle: Element, clientY: number) {
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY });
}

describe("ControllerPhaseSheet — grab handle drag-to-close (#1761)", () => {
    it("dragging the handle down past the dismiss threshold and releasing closes the sheet", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");

        pressHandle(handle, 0);
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 }); // past DISMISS_DRAG_PX (80)
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Stale-state race regression (review finding on #1761): `pointermove` is
    // a continuous-priority React event, `pointerup` a discrete one. On a
    // fast flick the last move's `setDragY` can still be an uncommitted
    // render when `pointerup` fires — a `commit()` that read the `dragY`
    // STATE would then close over a stale (possibly 0) value and spring the
    // sheet back instead of closing. `fireEvent` (used everywhere else in
    // this file) wraps every call in `act()`, which force-flushes React to
    // completion before returning — that's exactly why jsdom can't reproduce
    // the real race through it, no matter how the events are sequenced. This
    // test drives the three pointer events with raw `dispatchEvent` calls,
    // bypassing `act`'s wrapping so React's own scheduler decides when to
    // flush the move's update — closer to the real browser race than
    // anything `fireEvent` can express in jsdom. Against the pre-fix
    // state-only read this reliably reproduces the bug (onClose never
    // fires); against the ref-based fix (`press.current.dy`, mutated
    // synchronously in the same tick as the move, independent of whether
    // React has re-rendered) it reliably closes. React logs a benign
    // "not wrapped in act(...)" warning for the bypassed dispatches — expected
    // and harmless here, not a signal this test should wrap them after all.
    it("commit reads the live ref offset rather than a possibly-stale dragY render", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");

        handle.dispatchEvent(
            new PointerEvent("pointerdown", {
                pointerId: 1,
                button: 0,
                clientY: 0,
                bubbles: true,
                cancelable: true,
            })
        );
        handle.dispatchEvent(
            new PointerEvent("pointermove", {
                pointerId: 1,
                clientY: 100, // past DISMISS_DRAG_PX (80)
                bubbles: true,
                cancelable: true,
            })
        );
        handle.dispatchEvent(
            new PointerEvent("pointerup", {
                pointerId: 1,
                clientY: 100,
                bubbles: true,
                cancelable: true,
            })
        );
        // Flush whatever React deferred so the assertion observes the
        // settled outcome, not an in-flight update.
        act(() => {});

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("releasing short of the threshold springs back without closing", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");
        const panel = handle.parentElement as HTMLElement;

        pressHandle(handle, 0);
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 30 }); // short of 80
        expect(panel.style.transform).toBe("translateY(30px)");

        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 30 });

        expect(onClose).not.toHaveBeenCalled();
        // Spring-back state is clean: the drag offset resets to rest (no
        // leftover translateY), not just "not closed".
        expect(panel.style.transform).toBe("");
    });

    it("a sub-deadzone press (no real drag) does not close and leaves no offset", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");
        const panel = handle.parentElement as HTMLElement;

        pressHandle(handle, 0);
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 2 }); // under DRAG_START_PX (6)

        // Assert BEFORE pointerUp: a `pointerUp`/`commit()` always resets
        // `dragY` to 0 on a non-dismissing release, so asserting only
        // post-pointerUp is tautological — it would pass even if the
        // deadzone check were deleted entirely (DRAG_START_PX 6 → 0), since
        // the reset happens regardless of whether the drag ever activated.
        // Checking here proves the move itself never set an offset because
        // it stayed under the deadzone (`p.active` never flipped true).
        expect(panel.style.transform).toBe("");

        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 2 });

        expect(onClose).not.toHaveBeenCalled();
        expect(panel.style.transform).toBe("");
    });

    // Mobile drag regression (same shape as the library-order-picker /
    // trigger-order-prompt fix): a touch pointerdown gives the pressed PILL
    // (a child of the handle wrapper) implicit pointer capture. The wrapper's
    // first `setPointerCapture` call (fired once the drag activates)
    // transfers that capture away from the pill, which fires
    // `lostpointercapture` ON THE PILL — bubbling to the wrapper with
    // `e.target !== e.currentTarget`. Pre-fix this would commit() instantly,
    // killing the drag on its first move. The guard must ignore it and let
    // the drag continue to a real release.
    it("a pill→wrapper capture transfer does not kill an active drag (touch)", () => {
        const proto = Element.prototype as Element & {
            setPointerCapture: unknown;
            releasePointerCapture: unknown;
            hasPointerCapture: unknown;
        };
        proto.setPointerCapture = vi.fn();
        proto.releasePointerCapture = vi.fn();
        proto.hasPointerCapture = vi.fn(() => true);

        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");
        const pill = handle.firstElementChild as HTMLElement;

        // Press on the PILL (implicit capture lands there on real touch),
        // move past the deadzone on the WRAPPER (activates the drag and
        // calls setPointerCapture on the wrapper)...
        fireEvent.pointerDown(pill, { pointerId: 1, button: 0, clientY: 0 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20 });
        // ...the implicit-capture transfer fires lostpointercapture ON THE
        // PILL (target ≠ wrapper). Pre-fix this ended the drag right here.
        fireEvent.lostPointerCapture(pill, { pointerId: 1 });

        // The drag must still be alive: keep moving well past the dismiss
        // threshold and release — it must close.
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 150 });
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 150 });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a pointercancel mid-drag (past threshold) aborts without closing", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");
        const panel = handle.parentElement as HTMLElement;

        pressHandle(handle, 0);
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 }); // past DISMISS_DRAG_PX (80)
        expect(panel.style.transform).toBe("translateY(100px)");

        // A cancel (e.g. the OS taking over the gesture) must always abort
        // the drag, regardless of how far past the dismiss threshold it had
        // travelled — it is not a release and must never close the sheet.
        fireEvent.pointerCancel(handle, { pointerId: 1 });

        expect(onClose).not.toHaveBeenCalled();
        expect(panel.style.transform).toBe("");

        // The aborted press must not linger either: releasing the same
        // pointer afterwards is a no-op, not a second chance to close.
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("backdrop tap still closes the sheet", () => {
        const onClose = vi.fn();
        const { getAllByLabelText } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        // Backdrop button + the stubbed list's X button both carry this
        // label; the backdrop is the first one in DOM order.
        const [backdrop] = getAllByLabelText("Close phase list");
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("the X button (rendered by the phase list) still closes the sheet", () => {
        const onClose = vi.fn();
        const { getAllByLabelText } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const closeControls = getAllByLabelText("Close phase list");
        // Backdrop button + the stubbed list's X button both carry this label.
        expect(closeControls.length).toBe(2);
        fireEvent.click(closeControls[1]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Height-bound regression (review finding on #1761): the sheet panel
    // used to bound height only via `max-h-[70vh] overflow-hidden` on ITSELF
    // with no `display: flex`, so `ControllerPhaseList`'s `role="dialog"`
    // element (whose OWN inline `maxHeight: calc(100vh - 24px)` is the
    // desktop panel's bound, irrelevant once nested here) never got squeezed
    // down to the space actually left under the grab handle — its internal
    // `min-h-0 flex-1 overflow-y-auto` list never had a bounded ancestor and
    // never engaged its own scroll, hard-clipping the bottom rows (e.g.
    // Ending steps) on short viewports instead of scrolling to them. jsdom
    // has no layout engine to prove the list actually scrolls, so this
    // asserts the two halves of the fix as a source-level contract instead:
    // the panel wrapper is a flex column (so its child can be told to fill
    // and shrink), and the stylesheet override that lets the nested dialog
    // do so is present.
    it("the panel is a flex column so the nested dialog's internal scroll region can engage", () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <ControllerPhaseSheet onClose={onClose} />
        );
        const handle = getByTestId("phase-sheet-grab-handle");
        const panel = handle.parentElement as HTMLElement;

        expect(panel.className).toContain("flex");
        expect(panel.className).toContain("flex-col");
        expect(panel.className).toContain("overflow-hidden");
        expect(panel.className).toContain("max-h-[70vh]");
    });

    it("the [data-phase-sheet] [role=dialog] override lets the dialog fill and shrink inside the flex panel", () => {
        const css = readFileSync(
            resolve(process.cwd(), "src/index.css"),
            "utf8"
        );
        const marker = '[data-phase-sheet] [role="dialog"] {';
        const start = css.indexOf(marker);
        expect(
            start,
            "the phase-sheet dialog override rule is present"
        ).toBeGreaterThan(-1);
        const end = css.indexOf("}", start);
        const rule = css.slice(start, end);

        // `flex: 1` lets the dialog stretch to fill the space left under the
        // grab handle instead of sizing to its own inline max-height; `min-
        // height: 0` is the flex-item override that lets it actually SHRINK
        // below its content size so the internal `overflow-y-auto` list gets
        // a bounded ancestor to scroll within.
        expect(rule).toMatch(/flex:\s*1\s*;/);
        expect(rule).toMatch(/min-height:\s*0\s*;/);
    });
});
