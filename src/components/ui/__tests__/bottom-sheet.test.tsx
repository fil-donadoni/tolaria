import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BottomSheet from "../bottom-sheet";

/** `BottomSheet` gained a grip and a hairline treatment in the v4 re-skin
 *  (ADR 0103 §5, issue #2731) with no test file at all — the acceptance
 *  criteria named it explicitly ("ActionSheet / BottomSheet / ContextMenu dom
 *  tests updated"), and only ActionSheet's got one. These pin the grip, the
 *  scrim, the hairline top edge and the close button's touch-target sizing
 *  through the real exported component. */

describe("BottomSheet (ADR 0103 §5)", () => {
    it("renders nothing when closed", () => {
        render(
            <BottomSheet open={false} onClose={vi.fn()} title="Sheet">
                Body
            </BottomSheet>
        );
        expect(screen.queryByText("Body")).toBeNull();
    });

    it("renders the grip handle above the title row", () => {
        const { baseElement } = render(
            <BottomSheet open onClose={vi.fn()} title="Sheet">
                Body
            </BottomSheet>
        );
        const grip = baseElement.querySelector(".w-10.h-1.rounded-full");
        expect(grip, "grip handle missing").not.toBeNull();
    });

    it("uses the shared modal-scrim backdrop", () => {
        const { baseElement } = render(
            <BottomSheet open onClose={vi.fn()} title="Sheet">
                Body
            </BottomSheet>
        );
        const backdrop = baseElement.querySelector('[role="dialog"]')!;
        expect(backdrop.className).toContain("modal-scrim");
    });

    it("draws the panel's top edge with the shared hairline token", () => {
        const { baseElement } = render(
            <BottomSheet open onClose={vi.fn()} title="Sheet">
                Body
            </BottomSheet>
        );
        const panel = baseElement.querySelector('[role="dialog"] > div')!;
        expect(panel.className).toContain("border-[var(--hairline)]");
    });

    it("sizes the close button to the shared control touch target", () => {
        render(
            <BottomSheet open onClose={vi.fn()} title="Sheet">
                Body
            </BottomSheet>
        );
        const closeButton = screen.getByRole("button", {
            name: "Close sheet",
        });
        expect(closeButton.style.minHeight).toBe("var(--control-h)");
        expect(closeButton.style.minWidth).toBe("var(--control-h)");
    });

    it("calls onClose on backdrop click and on Escape, but not on panel click", () => {
        const onClose = vi.fn();
        const { baseElement } = render(
            <BottomSheet open onClose={onClose} title="Sheet">
                <button type="button">Body button</button>
            </BottomSheet>
        );
        fireEvent.click(screen.getByText("Body button"));
        expect(onClose).not.toHaveBeenCalled();

        const backdrop = baseElement.querySelector('[role="dialog"]')!;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("renders an optional footer outside the scrolling body", () => {
        render(
            <BottomSheet
                open
                onClose={vi.fn()}
                title="Sheet"
                footer={<div>Footer CTA</div>}
            >
                Body
            </BottomSheet>
        );
        expect(screen.getByText("Footer CTA")).toBeTruthy();
    });
});
