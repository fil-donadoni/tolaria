// One-time zoom hint (issue #9166): shown once per player, not every mount.
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDraftZoomHint } from "../useDraftZoomHint";

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
});
