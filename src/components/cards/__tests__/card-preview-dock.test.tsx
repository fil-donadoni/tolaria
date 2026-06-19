// Issue #332 — desktop card preview is a FIXED panel docked center-LEFT.
//
// These render-level tests assert the contract, not pixels:
//  - On the desktop hover path, the preview mounts at the fixed center-left
//    dock (`data-card-preview-dock`), anchored to the LEFT edge and vertically
//    centered (the layout contract), regardless of which card was hovered.
//  - The mobile long-press centered overlay path (ADR 0009) is untouched: it
//    still opens the centered backdrop overlay and never the center-left dock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import CardPreview from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";
import { HOVER_DELAY_MS } from "../card-preview";

function renderPreview() {
    return render(
        <CardPreview cardId="bolt" cardName="Lightning Bolt">
            <div data-testid="card-face">face</div>
        </CardPreview>
    );
}

describe("CardPreview desktop center-left dock (#332)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("mounts the preview at the fixed center-left dock on hover", () => {
        const { container } = renderPreview();
        const root = container.firstElementChild as HTMLElement;

        // Before hover, no dock.
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();

        // Hover and let the open delay elapse.
        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });

        const dock = document.querySelector<HTMLElement>(
            "[data-card-preview-dock]"
        );
        expect(dock).toBeTruthy();
        // Fixed-position, left-edge anchored, vertically centered — the layout
        // contract (a contract, not a pixel value).
        expect(dock!.className).toContain("fixed");
        expect(dock!.className).toContain("left-2");
        expect(dock!.className).toContain("top-1/2");
        expect(dock!.className).toContain("-translate-y-1/2");
    });

    it("disappears on mouse-out", () => {
        const { container } = renderPreview();
        const root = container.firstElementChild as HTMLElement;

        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });
        expect(document.querySelector("[data-card-preview-dock]")).toBeTruthy();

        // Pointer leaves outside the card's rect (jsdom rects are 0×0, so any
        // coordinate is outside) → close.
        fireEvent.mouseLeave(root, { clientX: 999, clientY: 999 });
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
    });

    it("leaves the mobile long-press overlay path untouched (no dock on touch)", () => {
        const { container } = renderPreview();
        const root = container.firstElementChild as HTMLElement;

        // Drive the touch long-press path (ADR 0009).
        fireEvent.touchStart(root, {
            touches: [{ clientX: 10, clientY: 10 }],
        });
        act(() => {
            vi.advanceTimersByTime(400);
        });

        // The centered overlay (mobile) opens — NOT the center-left dock.
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
        const overlay = document.querySelector(".fixed.inset-0");
        expect(overlay).toBeTruthy();
        // The overlay is the centered backdrop, distinct from the dock.
        expect(overlay!.className).toContain("items-center");
        expect(overlay!.className).toContain("justify-center");
    });

    it("ignores hover after a touch (touch device suppresses the desktop dock)", () => {
        const { container } = renderPreview();
        const root = container.firstElementChild as HTMLElement;

        // A touch marks the input as touch; subsequent synthetic mouse hover
        // (ghost events) must not open the desktop dock.
        fireEvent.touchStart(root, {
            touches: [{ clientX: 10, clientY: 10 }],
        });
        act(() => {
            fireEvent.mouseEnter(root);
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
    });
});
