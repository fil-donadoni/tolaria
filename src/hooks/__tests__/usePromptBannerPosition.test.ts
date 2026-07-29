// Shared positioning for the small "priority/choice" prompt banners (payment,
// mulligan, sacrifice, target-selection, attack-mana-tax, pending-choice —
// issue #1762). Desktop/landscape must keep the pre-existing centered +
// draggable behavior verbatim (no regression for the six banners that
// adopted this hook); portrait must drop the board-center position in favor
// of EITHER a vertically-centered panel (the issue #1813 default — nothing
// on the board to cover) OR a safe-area-aware top strip (`pinned: true` —
// reserved for a prompt whose interaction routes clicks to the mid-board),
// width-capped, with dragging disabled in both.
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
            "absolute top-1/2 left-1/2 z-modal pointer-events-none"
        );
        expect(result.current.innerClassName).toBe("pointer-events-auto");
        expect(result.current.outerStyle.transform).toBe(
            "translate(calc(-50% + 0px), calc(-50% + 0px))"
        );
        // Real drag handlers (not the portrait no-ops) — a genuine
        // `onPointerDown` closure closed over the live offset.
        expect(result.current.dragHandlers.onPointerDown).toBeInstanceOf(
            Function
        );
    });

    // Issue #1762 review finding 2 — the outer box's hit-test must stay
    // disabled (it shrink-wraps around the panel via the transform above, but
    // pointer-events must still be re-enabled somewhere or the panel itself
    // would be unclickable) while the inner wrapper — the actual panel — is
    // re-enabled.
    it("keeps the outer box pointer-events-none and the inner wrapper pointer-events-auto", () => {
        portrait = false;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.outerClassName).toContain("pointer-events-none");
        expect(result.current.innerClassName).toContain("pointer-events-auto");
    });
});

describe("usePromptBannerPosition — portrait, default (issue #1813)", () => {
    it("centers vertically and horizontally — never the safe-area top strip, never the old dead-center recipe", () => {
        portrait = true;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.outerClassName).not.toContain("top-1/2");
        expect(result.current.outerClassName).not.toContain("left-1/2");
        expect(result.current.outerClassName).toContain("fixed");
        expect(result.current.outerClassName).toContain("items-center");
        expect(result.current.outerClassName).toContain("justify-center");
        expect(result.current.outerClassName).not.toContain(
            "env(safe-area-inset-top)"
        );
        // Review fixup round 3 — pin the z-tier itself, not just its absence
        // from the pinned strip's `z-modal`: this centered default must sit
        // at `z-banner` (below the portrait stack chip's `z-chip` and any
        // real blocking modal's `z-modal`), never regress back to `z-modal`.
        expect(result.current.outerClassName).toContain("z-banner");
        // No JS transform offset in portrait — the panel is fixed/flex
        // centered, not dragged, so there is nothing to translate.
        expect(result.current.outerStyle.transform).toBeUndefined();
    });

    it("disables hit-testing on the full-bleed outer box, re-enabled on the inner panel wrapper", () => {
        portrait = true;
        const { result } = renderHook(() => usePromptBannerPosition());
        expect(result.current.outerClassName).toContain("pointer-events-none");
        expect(result.current.innerClassName).toContain("pointer-events-auto");
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

describe("usePromptBannerPosition — portrait, pinned: true (issue #1762, kept as an override by #1813)", () => {
    it("never centers on the board — pins to a safe-area top strip instead", () => {
        portrait = true;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
        expect(result.current.outerClassName).not.toContain("top-1/2");
        expect(result.current.outerClassName).not.toContain("left-1/2");
        expect(result.current.outerClassName).toContain("fixed");
        expect(result.current.outerClassName).toContain(
            "env(safe-area-inset-top)"
        );
        // No JS transform offset in portrait — the strip is pinned, not
        // dragged, so there is nothing to translate.
        expect(result.current.outerStyle.transform).toBeUndefined();
        // Review fixup round 3 — pin the z-tier itself: the pinned strip
        // deliberately stays at `z-modal` (unchanged from #1762), never
        // drifting down to the centered default's `z-banner`.
        expect(result.current.outerClassName).toContain("z-modal");
    });

    // Issue #1762 review finding 1 — a raw safe-area offset (`max(env(...),
    // 0.5rem)`) pinned the strip directly on top of the opponent nameplate
    // (`board-player.tsx`, `top-1`). The strip must clear it by reusing the
    // SAME `top-24` (6rem) offset `combat-panels.tsx` already parks its
    // declare-attackers dock at, plus the safe-area inset on top.
    it("clears the opponent nameplate by offsetting below it (top-24 + safe-area), never a bare safe-area inset", () => {
        portrait = true;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
        expect(result.current.outerClassName).toContain("6rem");
        expect(result.current.outerClassName).not.toContain(
            "max(env(safe-area-inset-top)"
        );
    });

    // Issue #1762 review finding 2 — the portrait strip spans the full
    // viewport width (`inset-x-0 ... flex justify-center`) so long copy can
    // still center itself; without `pointer-events-none` on that full-bleed
    // outer box, the empty gutters beside the (narrower) panel would swallow
    // board taps. The inner wrapper re-enables hit-testing for the panel.
    it("disables hit-testing on the full-bleed outer strip, re-enabled on the inner panel wrapper", () => {
        portrait = true;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
        expect(result.current.outerClassName).toContain("pointer-events-none");
        expect(result.current.innerClassName).toContain("pointer-events-auto");
    });

    it("width-caps the inner wrapper so long copy wraps instead of overflowing", () => {
        portrait = true;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
        expect(result.current.innerClassName).toContain("max-w-");
        expect(result.current.innerClassName).toContain("min-w-0");
    });

    it("disables dragging (no-op handlers) so touch drag never fights tap-to-act", () => {
        portrait = true;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
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

    // Issue #1813 — `pinned` is a no-op on desktop/landscape: always
    // centered + draggable there regardless.
    it("is a no-op on desktop/landscape — still centers on the board and stays draggable", () => {
        portrait = false;
        const { result } = renderHook(() =>
            usePromptBannerPosition({ pinned: true })
        );
        expect(result.current.outerClassName).toBe(
            "absolute top-1/2 left-1/2 z-modal pointer-events-none"
        );
        expect(result.current.dragHandlers.onPointerDown).toBeInstanceOf(
            Function
        );
    });
});
