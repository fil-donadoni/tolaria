// Divide-as-you-choose stepper state (CR 601.2d / 120.4). The client must send
// a per-target `amount` to `selectTarget`; without it the server falls back to
// an equal ≥1-each split (the Pyrokinesis "divides evenly" bug). These lock the
// budget math and the re-seed-on-commit behaviour the stepper depends on.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PendingTarget } from "~/types/game";
import {
    computeRemaining,
    clampAmount,
    useDivideAmountState,
} from "../useDivideAmount";

function divideTarget(overrides: Partial<PendingTarget> = {}): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "pyro-1",
        targetType: "Creature",
        count: { min: 1, max: 4 },
        selected: [],
        divideTotal: 4,
        ...overrides,
    } as PendingTarget;
}

describe("computeRemaining (CR 601.2d budget)", () => {
    it("is the full total when nothing is assigned", () => {
        expect(computeRemaining(divideTarget())).toBe(4);
    });

    it("subtracts the sum of committed per-target amounts", () => {
        const pt = divideTarget({
            divideAmounts: { "permanent:a": 3 },
        });
        expect(computeRemaining(pt)).toBe(1);
    });

    it("never goes negative and is 0 for a non-divide selection", () => {
        expect(
            computeRemaining(
                divideTarget({ divideAmounts: { "permanent:a": 9 } })
            )
        ).toBe(0);
        expect(computeRemaining(divideTarget({ divideTotal: undefined }))).toBe(
            0
        );
        expect(computeRemaining(undefined)).toBe(0);
    });
});

describe("clampAmount ([1, remaining], CR 601.2d ≥1 each)", () => {
    it("floors at 1 and caps at the remaining budget", () => {
        expect(clampAmount(0, 4)).toBe(1);
        expect(clampAmount(-5, 4)).toBe(1);
        expect(clampAmount(10, 4)).toBe(4);
        expect(clampAmount(2, 4)).toBe(2);
    });

    it("collapses to 0 only when nothing is left", () => {
        expect(clampAmount(3, 0)).toBe(0);
    });
});

describe("useDivideAmountState — re-seeds on identity / budget change", () => {
    it("seeds to 1 for a fresh divide spell", () => {
        const { result } = renderHook(() =>
            useDivideAmountState(divideTarget())
        );
        expect(result.current.rawAmount).toBe(1);
    });

    it("re-seeds to 1 after a target commits (remaining shrinks)", () => {
        const pt = divideTarget();
        const { result, rerender } = renderHook(
            (p: PendingTarget | undefined) => useDivideAmountState(p),
            { initialProps: pt as PendingTarget | undefined }
        );
        act(() => result.current.setRawAmount(3));
        expect(result.current.rawAmount).toBe(3);

        // A target took 3 → the running sum grew, identity key changes.
        rerender(divideTarget({ divideAmounts: { "permanent:a": 3 } }));
        expect(result.current.rawAmount).toBe(1);
    });

    it("seeds to the whole remainder when only one point is left", () => {
        const { result } = renderHook(() =>
            useDivideAmountState(
                divideTarget({ divideAmounts: { "permanent:a": 3 } })
            )
        );
        expect(result.current.rawAmount).toBe(1);
    });
});
