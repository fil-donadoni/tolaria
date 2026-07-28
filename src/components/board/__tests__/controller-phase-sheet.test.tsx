// Grab-handle drag-to-close gesture (issue #1761). The handle used to be pure
// decoration — the sheet only closed via the X button (rendered inside
// `ControllerPhaseList`, already covered by controller-phase-list.test.tsx)
// or the backdrop. These tests cover the NEW pointer-capture drag: down on
// the handle → move past threshold → up closes past the dismiss line, springs
// back short of it, and survives the touch implicit-pointer-capture transfer
// trap this repo has hit (and fixed) twice before
// (library-order-picker.tsx / trigger-order-prompt.tsx).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

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
});
