import { createPortal } from "react-dom";
import {
    copiesIn,
    pileEdgeShadow,
    sideboardDragLabel,
    type SideboardDrag,
    type SideboardPoolRow,
} from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";
import SideboardCardImage from "./sideboard-card-image";

/** Ghost width, px; the label may run past it. */
const GHOST_W = 120;

/** The card under the pointer while dragging (issue #9820), with a live label
 *  stating the drop ("1 copy → Sideboard" / "All 3 → Sideboard"). Flips to the
 *  pointer's left near the right edge so card and label stay on screen. */
export default function SideboardDragGhost({
    drag,
    row,
}: {
    drag: SideboardDrag;
    row: SideboardPoolRow;
}) {
    const pile = copiesIn(row, drag.from);
    const valid = drag.over !== null && drag.over !== drag.from;
    const all = pile > 1 && (drag.overAll || drag.shift);
    return createPortal(
        <div
            data-sideboard-drag-ghost
            className="pointer-events-none fixed z-[1000]"
            style={{
                width: GHOST_W,
                left:
                    drag.x + GHOST_W + 40 > window.innerWidth
                        ? drag.x - GHOST_W - 18
                        : drag.x + 18,
                top: Math.min(drag.y + 14, window.innerHeight - 210),
            }}
        >
            <div
                className="relative rotate-[4deg] rounded-[4.5%] drop-shadow-[0_14px_22px_rgba(0,0,0,.65)]"
                style={{ boxShadow: all ? pileEdgeShadow(pile, 3) : undefined }}
            >
                <SideboardCardImage cardId={row.cardId} name={row.name} />
            </div>
            <div
                className={cn(
                    "mt-2 w-max rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-lg",
                    valid
                        ? "bg-accent text-surface-base"
                        : "bg-black/85 text-white ring-1 ring-white/30"
                )}
            >
                {sideboardDragLabel(drag, row)}
            </div>
        </div>,
        document.body
    );
}
