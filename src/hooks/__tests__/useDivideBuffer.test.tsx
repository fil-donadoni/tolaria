// Divide-as-you-choose distribution buffer (CR 601.2d / 120.4). The chosen
// interaction (prototype variant B): dial each target's share freely via
// on-card steppers, then "Deal damage" submits the whole split. The buffer is
// local until submit; submit fires ONE batched `selectTargets` call for the
// whole distribution (issue #1779 / PRD #1776 T4 — the server auto-finalizes
// once the running divide sum reaches the total).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PendingTarget } from "~/types/game";

const selectTargets = vi.fn(() => Promise.resolve());
vi.mock("convex/react", () => ({
    useMutation: () => selectTargets,
}));

import { useDivideBufferState } from "../useDivideBuffer";

const GAME_ID = "game1" as never;

function dividePt(total: number): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "pyro1",
        targetType: "Creature",
        selected: [],
        divideTotal: total,
    } as unknown as PendingTarget;
}

function render(pendingTarget: PendingTarget | undefined) {
    return renderHook(
        (pt: PendingTarget | undefined) =>
            useDivideBufferState({ gameId: GAME_ID, pendingTarget: pt }),
        { initialProps: pendingTarget }
    );
}

describe("useDivideBuffer — local distribution (CR 601.2d)", () => {
    it("is inert for a non-divide selection", () => {
        const { result } = render(undefined);
        expect(result.current.active).toBe(false);
        expect(result.current.total).toBe(0);
    });

    // QA (Pollen Remedy): the banner used to hard-code "Deal damage" for
    // every divide-as-you-choose spell, including Pollen Remedy's divided
    // damage PREVENTION (CR 615.1). `kind` mirrors `pendingTarget.divideKind`
    // — "deal" when absent (every other divide card: Pyrokinesis, Arc
    // Lightning, ...), "prevent" only when the server sets it.
    it('defaults kind to "deal" when divideKind is absent', () => {
        const { result } = render(dividePt(4));
        expect(result.current.kind).toBe("deal");
    });

    it('reads kind "prevent" from pendingTarget.divideKind', () => {
        const { result } = render({
            ...dividePt(3),
            divideKind: "prevent",
        } as unknown as PendingTarget);
        expect(result.current.kind).toBe("prevent");
    });

    it("inc/dec dial a target and track remaining, capped at the budget", () => {
        const { result } = render(dividePt(4));
        expect(result.current.remaining).toBe(4);

        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("a", "permanent"));
        expect(result.current.get("a")).toBe(2);
        expect(result.current.remaining).toBe(2);

        act(() => result.current.inc("b", "permanent"));
        act(() => result.current.inc("b", "permanent"));
        expect(result.current.remaining).toBe(0);

        // Budget spent — a further inc is a no-op (CR 601.2d, ≤ total).
        act(() => result.current.inc("c", "permanent"));
        expect(result.current.get("c")).toBe(0);

        act(() => result.current.dec("a"));
        expect(result.current.get("a")).toBe(1);
        expect(result.current.remaining).toBe(1);
    });

    it("canSubmit only when the whole budget is assigned across ≥1 target", () => {
        const { result } = render(dividePt(4));
        expect(result.current.canSubmit).toBe(false);
        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("a", "permanent"));
        expect(result.current.canSubmit).toBe(false); // 3/4
        act(() => result.current.inc("b", "permanent"));
        expect(result.current.canSubmit).toBe(true); // 4/4
    });

    it("submit fires ONE batched selectTargets call with every target's chosen amount", async () => {
        selectTargets.mockClear();
        const { result } = render(dividePt(4));
        act(() => result.current.inc("a", "permanent")); // a: 3
        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("b", "permanent")); // b: 1
        await act(async () => {
            await result.current.submit();
        });
        expect(selectTargets).toHaveBeenCalledTimes(1);
        expect(selectTargets).toHaveBeenCalledWith({
            gameId: GAME_ID,
            playerId: "me",
            targets: [
                { targetType: "permanent", targetId: "a", amount: 3 },
                { targetType: "permanent", targetId: "b", amount: 1 },
            ],
        });
    });

    it("submit is a no-op until the budget is fully assigned", async () => {
        selectTargets.mockClear();
        const { result } = render(dividePt(4));
        act(() => result.current.inc("a", "permanent")); // only 1/4
        await act(async () => {
            await result.current.submit();
        });
        expect(selectTargets).not.toHaveBeenCalled();
    });

    it("resets the buffer when the divide selection identity changes", () => {
        const { result, rerender } = render(dividePt(4));
        act(() => result.current.inc("a", "permanent"));
        expect(result.current.get("a")).toBe(1);

        // A different source spell → fresh buffer.
        rerender({
            ...dividePt(4),
            cardInstanceId: "pyro2",
        } as unknown as PendingTarget);
        expect(result.current.get("a")).toBe(0);
        expect(result.current.sum).toBe(0);
    });

    it("does NOT reset when only selected/divideAmounts grow (mid-submit)", () => {
        const { result, rerender } = render(dividePt(4));
        act(() => result.current.inc("a", "permanent"));
        act(() => result.current.inc("a", "permanent"));
        // Server records the first target mid-sequence — same spell + total, so
        // the local buffer must survive (identity keyed on cardInstanceId:total).
        rerender({
            ...dividePt(4),
            selected: [{ type: "permanent", id: "a" }],
            divideAmounts: { "permanent:a": 2 },
        } as unknown as PendingTarget);
        expect(result.current.get("a")).toBe(2);
    });
});
