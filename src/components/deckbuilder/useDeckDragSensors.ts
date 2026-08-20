import { useMemo } from "react";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import {
    MOUSE_DRAG_DISTANCE_PX,
    TOUCH_HOLD_MS,
    TOUCH_MOVE_TOLERANCE_PX,
} from "~/lib/gesture/activation";

/**
 * The ONE sensor configuration every deckbuilder drag surface uses (issue
 * #1622 — it was copy-pasted between the two builders before).
 *
 * dnd-kit stays the drag TRANSPORT here; what it is no longer allowed to be is
 * a second opinion about ACTIVATION (issue #2583, PRD #2405). The three
 * thresholds come from `~/lib/gesture/activation`, the pure decision core the
 * touch gesture engine reduces over, so a threshold changed in one place can
 * never leave the two paths disagreeing about whether a given press is a drag.
 * `useDeckDragSensors.test.ts` asserts the configured values ARE those
 * constants.
 *
 * Touch drag waits {@link TOUCH_HOLD_MS} so a quick swipe still scrolls the
 * list and only a deliberate hold-then-move starts a drag; moving more than
 * {@link TOUCH_MOVE_TOLERANCE_PX} first cancels it (dnd-kit's `Delay`
 * tolerance = the reducer's scroll decision). Mouse drag starts after
 * {@link MOUSE_DRAG_DISTANCE_PX}.
 */
export function useDeckDragSensors() {
    return useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (event: PointerEvent) =>
                    event.pointerType === "touch"
                        ? [
                              new PointerActivationConstraints.Delay({
                                  value: TOUCH_HOLD_MS,
                                  tolerance: TOUCH_MOVE_TOLERANCE_PX,
                              }),
                          ]
                        : [
                              new PointerActivationConstraints.Distance({
                                  value: MOUSE_DRAG_DISTANCE_PX,
                              }),
                          ],
            }),
            KeyboardSensor,
        ],
        []
    );
}
