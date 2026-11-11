// One-time zoom hint (issue #9166): shown once per player, not every mount.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DRAFT_ZOOM_HINT_MS, useDraftZoomHint } from "../useDraftZoomHint";

beforeEach(() => window.localStorage.clear());

describe("useDraftZoomHint", () => {
    it("shows on first mount, stays gone after a dismiss, even on remount", () => {
        const first = renderHook(() => useDraftZoomHint());
        expect(first.result.current.visible).toBe(true);
        act(() => first.result.current.dismiss());
        expect(first.result.current.visible).toBe(false);
        first.unmount();

        const second = renderHook(() => useDraftZoomHint());
        expect(second.result.current.visible).toBe(false);
    });

    it("an inactive surface (phone) never burns the hint on its timer", () => {
        vi.useFakeTimers();
        try {
            const phone = renderHook(() => useDraftZoomHint(false));
            act(() => vi.advanceTimersByTime(DRAFT_ZOOM_HINT_MS + 1000));
            expect(phone.result.current.visible).toBe(true);
            expect(
                window.localStorage.getItem("tolaria:draftZoomHintSeen")
            ).toBe(null);
            phone.unmount();

            const desktop = renderHook(() => useDraftZoomHint(true));
            act(() => vi.advanceTimersByTime(DRAFT_ZOOM_HINT_MS + 1000));
            expect(desktop.result.current.visible).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
