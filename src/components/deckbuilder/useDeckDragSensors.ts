import { useMemo } from "react";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";

/**
 * The ONE sensor configuration every deckbuilder drag surface uses (issue
 * #1622 — it was copy-pasted between the two builders before).
 *
 * Touch drag waits ~250ms so a quick swipe still scrolls the list and only a
 * deliberate hold-then-move starts a drag (under the 400ms long-press preview
 * threshold, so the two never collide). Mouse drag starts after a small move.
 */
export function useDeckDragSensors() {
    return useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (event: PointerEvent) =>
                    event.pointerType === "touch"
                        ? [
                              new PointerActivationConstraints.Delay({
                                  value: 250,
                                  tolerance: 10,
                              }),
                          ]
                        : [
                              new PointerActivationConstraints.Distance({
                                  value: 8,
                              }),
                          ],
            }),
            KeyboardSensor,
        ],
        []
    );
}
