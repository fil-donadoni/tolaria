/** Shared window event asking every DOM arrow-anchor publisher to re-measure
 *  (the stack panel is user-draggable via CSS transform, which fires no
 *  resize/scroll event — without this, arrow endpoints would go stale).
 *  Extracted from the retired leader-line-new wiring (phase 2); the event is
 *  the live part, the library was not. */
export const ANCHORS_REPOSITION_EVENT = "arrowanchors:reposition";

export function repositionAnchors(): void {
    window.dispatchEvent(new Event(ANCHORS_REPOSITION_EVENT));
}
