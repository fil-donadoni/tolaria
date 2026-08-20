import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
    MOUSE_DRAG_DISTANCE_PX,
    TOUCH_HOLD_MS,
    TOUCH_MOVE_TOLERANCE_PX,
} from "~/lib/gesture/activation";
import { useDeckDragSensors } from "../useDeckDragSensors";

/** dnd-kit constraint instances expose their configuration as `.options`
 *  (probed against `@dnd-kit/dom`): `Delay` → `{ value, tolerance }`,
 *  `Distance` → `{ value }`. */
type ConstraintLike = { options: { value: number; tolerance?: number } };

function constraintsFor(pointerType: string): ConstraintLike[] {
    const { result } = renderHook(() => useDeckDragSensors());
    const pointerSensor = result.current[0] as unknown as {
        options: {
            activationConstraints: (event: PointerEvent) => ConstraintLike[];
        };
    };
    return pointerSensor.options.activationConstraints({
        pointerType,
    } as PointerEvent);
}

// The drift guard for the seam described in `~/lib/gesture/activation`: the
// touch gesture engine and dnd-kit are two code paths that must make the SAME
// activation decision. Reading the constants is what keeps them honest, and
// this test is what notices if someone types a literal back in.
describe("useDeckDragSensors activation thresholds (issue #2583)", () => {
    it("configures the touch Delay from the gesture core's constants", () => {
        const [delay, ...rest] = constraintsFor("touch");
        expect(rest).toHaveLength(0);
        expect(delay.options.value).toBe(TOUCH_HOLD_MS);
        expect(delay.options.tolerance).toBe(TOUCH_MOVE_TOLERANCE_PX);
    });

    it("configures the mouse Distance from the gesture core's constant", () => {
        const [distance, ...rest] = constraintsFor("mouse");
        expect(rest).toHaveLength(0);
        expect(distance.options.value).toBe(MOUSE_DRAG_DISTANCE_PX);
    });

    it("pins the shipped model-A numbers, so a constant edit is deliberate", () => {
        // Not a restatement of the constants: this is the second half of the
        // guard. The two tests above prove sensor == core; this one proves the
        // core is still 250 / 10 / 8 — the values the prototype's phone
        // testing settled on (PRD #2405 gesture model A). Changing them is
        // allowed; changing them SILENTLY is not.
        expect(TOUCH_HOLD_MS).toBe(250);
        expect(TOUCH_MOVE_TOLERANCE_PX).toBe(10);
        expect(MOUSE_DRAG_DISTANCE_PX).toBe(8);
    });
});
