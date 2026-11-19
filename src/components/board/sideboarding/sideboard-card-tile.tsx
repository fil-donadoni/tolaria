import {
    copiesIn,
    otherZone,
    pileEdgeShadow,
    zoneChange,
    zoneName,
    type SideboardPoolRow,
    type SideboardTileHandlers,
    type SideboardZone,
} from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";
import SideboardCardImage from "./sideboard-card-image";

/** Px of each cascaded card left visible: its printed name bar. */
const PEEK_PX = 36;

const BADGE_TONE = {
    gained: "bg-success text-surface-base",
    reduced: "bg-black/90 text-white ring-2 ring-danger",
    same: "bg-black/90 text-white ring-1 ring-white/35",
} as const;

/** One card of a cascade (issue #9820): the printed face, cascaded so only
 *  its name bar shows unless it is the column's last; a pile of 2+ draws an
 *  edge per extra copy; ONE ×N badge hangs off the right edge, coloured by
 *  the change. Click = one copy to the other zone, Shift+click = every copy;
 *  a press can also start a drag. */
export default function SideboardCardTile({
    row,
    zone,
    last,
    focusId,
    onFocus,
    onMove,
    onDragStart,
    suppressClick,
    draggingId,
    disabled,
}: {
    row: SideboardPoolRow;
    zone: SideboardZone;
    last: boolean;
} & SideboardTileHandlers) {
    const here = copiesIn(row, zone);
    const to = otherZone(zone);
    const change = zoneChange(row, zone);
    return (
        <li
            data-row-id={row.cardId}
            className="group relative"
            style={{ height: last ? undefined : PEEK_PX }}
            onDragStart={(e) => e.preventDefault()}
        >
            <button
                type="button"
                disabled={disabled}
                data-sideboard-card={row.cardId}
                data-zone={zone}
                onPointerEnter={() => onFocus(row.cardId)}
                onFocus={() => onFocus(row.cardId)}
                onPointerDown={(e) => {
                    if (!disabled) onDragStart(e, row.cardId, zone);
                }}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => {
                    if (suppressClick.current) return;
                    onMove(row.cardId, to, e.shiftKey);
                }}
                aria-label={`${row.name}, ${here} ${here === 1 ? "copy" : "copies"}. Move one to the ${zoneName(to)}`}
                className={cn(
                    "relative block w-full cursor-grab touch-pan-y rounded-[4.5%] transition-transform duration-100 select-none [-webkit-touch-callout:none] group-hover:-translate-y-1 disabled:cursor-default",
                    // the focus ring only where the inspector it points at exists
                    row.cardId === focusId &&
                        "lg:ring-2 lg:ring-accent lg:ring-offset-2 lg:ring-offset-surface",
                    row.cardId === draggingId && "scale-[0.97] brightness-75"
                )}
                style={{ boxShadow: pileEdgeShadow(here) }}
            >
                <SideboardCardImage cardId={row.cardId} name={row.name} />
                <span
                    data-copy-badge={change}
                    className={cn(
                        "absolute top-[5px] -right-2.5 min-w-[26px] rounded-full px-1.5 text-center text-[12px] leading-[20px] font-bold tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.6)]",
                        BADGE_TONE[change]
                    )}
                >
                    ×{here}
                </span>
            </button>
        </li>
    );
}
