// PROTOTYPE — throwaway. The floating copy of the card being dragged.
import { getImageUrl } from "~/lib/images";
import type { DragState } from "./use-touch-move-engine";

export default function TouchDragGhost({
    drag,
    cardId,
}: {
    drag: DragState;
    cardId: string;
}) {
    return (
        <img
            src={getImageUrl(cardId)}
            alt=""
            draggable={false}
            className="pointer-events-none fixed z-[9997] w-[92px] rounded-[6%] shadow-[0_14px_30px_rgba(0,0,0,.8)] ring-2 ring-accent"
            style={{
                left: drag.x,
                top: drag.y,
                transform: "translate(-50%,-70%) rotate(-3deg) scale(1.05)",
            }}
        />
    );
}
