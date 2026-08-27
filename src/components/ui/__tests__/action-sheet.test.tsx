import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ActionSheet, { type ActionSheetItem } from "../action-sheet";

function makeItems(onSelect = vi.fn()): ActionSheetItem[] {
    return [
        { key: "cast", label: "Cast", onSelect },
        { key: "ability", label: "{T}: Deal 1 damage", onSelect },
    ];
}

describe("ActionSheet", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("renders nothing when closed", () => {
        render(
            <ActionSheet open={false} onClose={vi.fn()} items={makeItems()} />
        );
        expect(screen.queryByText("Cast")).toBeNull();
    });

    it("renders one button per item when open", () => {
        render(<ActionSheet open onClose={vi.fn()} items={makeItems()} />);
        expect(screen.getByText("Cast")).toBeTruthy();
        expect(screen.getByText("{T}: Deal 1 damage")).toBeTruthy();
    });

    it("gives each item the 44px menu-row touch target (ADR 0103 §5)", () => {
        render(<ActionSheet open onClose={vi.fn()} items={makeItems()} />);
        const button = screen.getByText("Cast").closest("button")!;
        expect(button.className).toContain("min-h-[var(--menu-row-h)]");
    });

    it("invokes the item's onSelect then closes on click", () => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        render(
            <ActionSheet open onClose={onClose} items={makeItems(onSelect)} />
        );
        fireEvent.click(screen.getByText("Cast"));
        expect(onSelect).toHaveBeenCalledOnce();
        // handleClose defers onClose behind the slide-out animation.
        act(() => vi.advanceTimersByTime(200));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("dismisses (onClose) when the backdrop is clicked", () => {
        const onClose = vi.fn();
        const { baseElement } = render(
            <ActionSheet open onClose={onClose} items={makeItems()} />
        );
        // Backdrop is the outermost portal child; the sheet stops propagation.
        const backdrop = baseElement.querySelector(".fixed.inset-0")!;
        fireEvent.click(backdrop);
        act(() => vi.advanceTimersByTime(200));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
