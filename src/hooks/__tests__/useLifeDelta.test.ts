import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLifeDelta } from "../useLifeDelta";

describe("useLifeDelta", () => {
    it("reports no delta on first render", () => {
        const { result } = renderHook(() => useLifeDelta(20));
        expect(result.current).toEqual({ delta: 0, tick: 0 });
    });

    it("reports a negative delta on life loss and bumps tick", () => {
        const { result, rerender } = renderHook(
            ({ life }) => useLifeDelta(life),
            {
                initialProps: { life: 20 },
            }
        );
        rerender({ life: 17 });
        expect(result.current.delta).toBe(-3);
        expect(result.current.tick).toBe(1);
    });

    it("reports a positive delta on life gain", () => {
        const { result, rerender } = renderHook(
            ({ life }) => useLifeDelta(life),
            {
                initialProps: { life: 17 },
            }
        );
        rerender({ life: 22 });
        expect(result.current.delta).toBe(5);
        expect(result.current.tick).toBe(1);
    });

    it("retriggers (new tick) on a repeated identical delta", () => {
        const { result, rerender } = renderHook(
            ({ life }) => useLifeDelta(life),
            {
                initialProps: { life: 20 },
            }
        );
        rerender({ life: 17 }); // -3, tick 1
        rerender({ life: 14 }); // -3 again, tick 2
        expect(result.current.delta).toBe(-3);
        expect(result.current.tick).toBe(2);
    });

    it("does not change when life is unchanged across rerenders", () => {
        const { result, rerender } = renderHook(
            ({ life }) => useLifeDelta(life),
            {
                initialProps: { life: 20 },
            }
        );
        rerender({ life: 20 });
        expect(result.current).toEqual({ delta: 0, tick: 0 });
    });
});
