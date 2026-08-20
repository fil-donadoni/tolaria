import { getImageUrl, resolveCardImageId } from "~/lib/images";
import type { GestureDrag } from "~/lib/gesture/useGestureEngine";

/** The card that follows the finger during a touch drag (PRD #2405, issue
 *  #2583). Rendered by the surface from `useGestureEngine().drag`.
 *
 *  `pointer-events-none` is load-bearing, not decoration: the engine resolves
 *  the drop target with `document.elementFromPoint` at the finger, and a
 *  hit-testable ghost sitting exactly there would be the only thing it ever
 *  found. */
export default function DragGhost({
    drag,
    cardId,
}: {
    drag: GestureDrag;
    /** Registry card id of the dragged card — the surface maps `drag.key`
     *  (its own handle) to a card. */
    cardId: string;
}) {
    const printId = resolveCardImageId(cardId);
    if (!printId) return null;
    return (
        <img
            data-drag-ghost={drag.key}
            data-over={drag.over ?? undefined}
            src={getImageUrl(printId)}
            alt=""
            draggable={false}
            className="z-modal-peak pointer-events-none fixed w-[92px] rounded-[6%] shadow-[0_14px_30px_rgba(0,0,0,.8)] ring-2 ring-accent"
            style={{
                left: drag.x,
                top: drag.y,
                // Lifted above the finger so the card is not under the thumb
                // that is dragging it.
                transform: "translate(-50%,-70%) rotate(-3deg) scale(1.05)",
            }}
        />
    );
}
