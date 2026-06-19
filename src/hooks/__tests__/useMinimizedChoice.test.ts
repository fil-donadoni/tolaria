// Per-choice minimize toggle for blocking choice dialogs (issue #315).
// The flag is client-only view state: it must reset when the active Pending
// Choice resolves (identity key changes / queue empties) and never persist.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMinimizedChoiceState } from "../useMinimizedChoice";
import type { PendingChoice } from "~/types/game";

function makeChoice(overrides: Partial<PendingChoice> = {}): PendingChoice {
    return {
        stackItemId: "stack-1",
        step: 0,
        choiceId: "c1",
        playerId: "p1",
        kind: "search-library",
        zone: "library",
        count: 1,
        prompt: "Search your library",
        ...overrides,
    };
}

describe("useMinimizedChoiceState (issue #315)", () => {
    it("starts expanded (not minimized)", () => {
        const { result } = renderHook(() =>
            useMinimizedChoiceState(makeChoice())
        );
        expect(result.current.isMinimized).toBe(false);
    });

    it("minimize() collapses and restore() expands", () => {
        const { result } = renderHook(() =>
            useMinimizedChoiceState(makeChoice())
        );
        act(() => result.current.minimize());
        expect(result.current.isMinimized).toBe(true);
        act(() => result.current.restore());
        expect(result.current.isMinimized).toBe(false);
    });

    it("a new Pending Choice (different identity) starts expanded — per-choice reset", () => {
        const { result, rerender } = renderHook(
            ({ choice }) => useMinimizedChoiceState(choice),
            { initialProps: { choice: makeChoice() } }
        );
        act(() => result.current.minimize());
        expect(result.current.isMinimized).toBe(true);

        // Next choice in the chain (different choiceId) — flag must reset.
        rerender({ choice: makeChoice({ choiceId: "c2" }) });
        expect(result.current.isMinimized).toBe(false);
    });

    it("resets when the choice queue empties (undefined)", () => {
        const { result, rerender } = renderHook(
            ({ choice }: { choice: PendingChoice | undefined }) =>
                useMinimizedChoiceState(choice),
            {
                initialProps: {
                    choice: makeChoice() as PendingChoice | undefined,
                },
            }
        );
        act(() => result.current.minimize());
        expect(result.current.isMinimized).toBe(true);

        rerender({ choice: undefined });
        expect(result.current.isMinimized).toBe(false);
    });

    it("stays minimized across re-renders for the SAME choice identity", () => {
        const choice = makeChoice();
        const { result, rerender } = renderHook(
            ({ c }) => useMinimizedChoiceState(c),
            { initialProps: { c: choice } }
        );
        act(() => result.current.minimize());
        // Re-render with an equivalent-identity choice object (new reference,
        // same keys) — the flag must persist.
        rerender({ c: makeChoice() });
        expect(result.current.isMinimized).toBe(true);
    });
});
