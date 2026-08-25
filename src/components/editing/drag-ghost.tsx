import { getImageUrl, resolveCardImageId } from "~/lib/images";
import type { GestureDrag } from "~/lib/gesture/useGestureEngine";

/** The card that follows the finger during a touch drag (PRD #2405, issue
 *  #2583). Rendered by the surface from `useGestureEngine().drag`.
 *
 *  `pointer-events-none` is load-bearing, not decoration: the engine resolves
 *  the drop target with `document.elementFromPoint` at the finger, and a
 *  hit-testable ghost sitting exactly there would be the only thing it ever
 *  found.
 *
 *  The ring rides on a WRAPPER `<div>`, never on the `<img>` (issue #2724
 *  review): `.card-ring` paints through an `::after` pseudo-element, and a
 *  REPLACED element (`img`, `video`, `canvas`, `input`) generates no
 *  `::before`/`::after` box at all — CSS Display 3 §3.1. Putting the recipe on
 *  the image deletes the ring outright while LOOKING correct, because
 *  `border-radius` (the other half of `.card-ring`) does apply to a replaced
 *  element, so the printed corner survives and only the ring silently
 *  disappears. `card-ring-replaced-elements.test.ts` guards the class of
 *  error; the image keeps `.card-corner` so the probe still sees the card's
 *  own corner on the card's own box. */
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
        <div
            data-drag-ghost={drag.key}
            data-over={drag.over ?? undefined}
            className="z-modal-peak pointer-events-none fixed w-[92px] card-ring card-ring-selected shadow-[0_14px_30px_rgba(0,0,0,.8)]"
            style={{
                left: drag.x,
                top: drag.y,
                // Lifted above the finger so the card is not under the thumb
                // that is dragging it.
                transform: "translate(-50%,-70%) rotate(-3deg) scale(1.05)",
            }}
        >
            <img
                src={getImageUrl(printId)}
                alt=""
                draggable={false}
                className="block w-full card-corner"
            />
        </div>
    );
}
