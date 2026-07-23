import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttackSequenceState } from "../useAttackSequence";

describe("useAttackSequenceState (design 2026-07-23)", () => {
    it("starts inactive", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        expect(result.current.active).toBe(false);
        expect(result.current.currentAttackerId).toBeUndefined();
    });

    it("begin activates and points at the first attacker", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.begin(["a", "b", "c"]));
        expect(result.current.active).toBe(true);
        expect(result.current.index).toBe(0);
        expect(result.current.currentAttackerId).toBe("a");
    });

    it("begin with an empty order stays inactive", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.begin([]));
        expect(result.current.active).toBe(false);
    });

    it("advance walks each attacker then deactivates past the last", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.begin(["a", "b"]));
        expect(result.current.currentAttackerId).toBe("a");
        act(() => result.current.advance());
        expect(result.current.currentAttackerId).toBe("b");
        expect(result.current.active).toBe(true);
        act(() => result.current.advance());
        expect(result.current.active).toBe(false);
        expect(result.current.currentAttackerId).toBeUndefined();
    });

    it("reset abandons an in-progress sequence", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.begin(["a", "b"]));
        act(() => result.current.reset());
        expect(result.current.active).toBe(false);
        expect(result.current.order).toEqual([]);
    });

    it("auto-resets when the relevance key changes", () => {
        const { result, rerender } = renderHook(
            ({ k }) => useAttackSequenceState(k),
            { initialProps: { k: "turn1" } }
        );
        act(() => result.current.begin(["a", "b"]));
        expect(result.current.active).toBe(true);
        rerender({ k: "turn2" });
        expect(result.current.active).toBe(false);
        expect(result.current.order).toEqual([]);
    });
});
