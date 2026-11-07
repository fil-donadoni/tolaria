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

    // CR 508.1b — client-only awaiting set (issue #8178).
    it("toggleAwaiting adds then removes; resolveAwaiting drops the given ids", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.toggleAwaiting("a"));
        act(() => result.current.toggleAwaiting("b"));
        expect(result.current.awaiting).toEqual(["a", "b"]);
        expect(result.current.choosingTarget).toBe(true);
        expect(result.current.undecidedAttackerIds).toEqual(["a", "b"]);
        act(() => result.current.toggleAwaiting("a"));
        expect(result.current.awaiting).toEqual(["b"]);
        act(() => result.current.resolveAwaiting(["b"]));
        expect(result.current.awaiting).toEqual([]);
        expect(result.current.choosingTarget).toBe(false);
    });

    it("the awaiting set resets when the key changes (window left)", () => {
        const { result, rerender } = renderHook(
            ({ k }) => useAttackSequenceState(k),
            { initialProps: { k: "t1:DECLARE_ATTACKERS:open" } }
        );
        act(() => result.current.toggleAwaiting("a"));
        expect(result.current.awaiting).toEqual(["a"]);
        rerender({ k: "t1:DECLARE_ATTACKERS:confirmed" });
        expect(result.current.awaiting).toEqual([]);
    });

    it("the sequence's unassigned tail has no target yet", () => {
        const { result } = renderHook(() => useAttackSequenceState("k"));
        act(() => result.current.begin(["a", "b", "c"]));
        act(() => result.current.advance());
        expect(result.current.undecidedAttackerIds).toEqual(["b", "c"]);
    });
});
