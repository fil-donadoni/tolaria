// Shared positioning for the small "priority/choice" prompt banners (payment,
// mulligan, sacrifice, target-selection, attack-mana-tax, pending-choice —
// issue #1762). Desktop/landscape must keep the pre-existing centered +
// draggable behavior verbatim (no regression for the six banners that
// adopted this hook); portrait must drop the board-center position in favor
// of a safe-area-aware top strip, width-capped, with dragging disabled.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";

// The single seam under test — drive it explicitly so jsdom's flaky
// matchMedia never decides the branch (same pattern as
// controller-portrait.test.tsx).
let portrait = false;
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => portrait,
}));

const { usePromptBannerPosition } = await import("../usePromptBannerPosition");

afterEach(() => {
    portrait = false;
});

describe("usePromptBannerPosition — landscape/desktop (unchanged behavior)", () => {
    it("centers on the board via top-1/2 left-1/2 and stays draggable", () => {
        portrait = false;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.outerClassName).toBe(
            "absolute top-1/2 left-1/2 z-modal"
        );
        expect(result.current.innerClassName).toBe("");
        expect(result.current.outerStyle.transform).toBe(
            "translate(calc(-50% + 0px), calc(-50% + 0px))"
        );
        // Real drag handlers (not the portrait no-ops) — a genuine
        // `onPointerDown` closure closed over the live offset.
        expect(result.current.dragHandlers.onPointerDown).toBeInstanceOf(
            Function
        );
    });
});

describe("usePromptBannerPosition — portrait (issue #1762)", () => {
    it("never centers on the board — pins to a safe-area top strip instead", () => {
        portrait = true;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.outerClassName).not.toContain("top-1/2");
        expect(result.current.outerClassName).not.toContain("left-1/2");
        expect(result.current.outerClassName).toContain("fixed");
        expect(result.current.outerClassName).toContain(
            "env(safe-area-inset-top)"
        );
        // No JS transform offset in portrait — the strip is pinned, not
        // dragged, so there is nothing to translate.
        expect(result.current.outerStyle.transform).toBeUndefined();
    });

    it("width-caps the inner wrapper so long copy wraps instead of overflowing", () => {
        portrait = true;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.innerClassName).toContain("max-w-");
        expect(result.current.innerClassName).toContain("min-w-0");
    });

    it("disables dragging (no-op handlers) so touch drag never fights tap-to-act", () => {
        portrait = true;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(() =>
            result.current.dragHandlers.onPointerDown(
                {} as ReactPointerEvent<HTMLElement>
            )
        ).not.toThrow();
        expect(() =>
            result.current.dragHandlers.onPointerMove(
                {} as ReactPointerEvent<HTMLElement>
            )
        ).not.toThrow();
    });
});
