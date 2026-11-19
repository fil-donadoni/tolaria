import { useMemo, useRef, type ReactNode } from "react";
import useRowFocusFallback from "~/hooks/useRowFocusFallback";
import type { SideboardDrag } from "~/hooks/useSideboardDrag";
import {
    zoneName,
    type SideboardPoolRow,
    type SideboardZone,
} from "~/lib/sideboard-pool";
import SideboardDropZone from "./sideboard-drop-zone";
import SideboardZoneLabel from "./sideboard-zone-label";

/** One zone of the window (issue #9820): a drop target holding its label and
 *  cascades, scrolling on its own. A tile whose last copy leaves takes focus
 *  with it: focus moves to its neighbour, else the dialog title, never the
 *  Popup (issue #9819). */
export default function SideboardZonePane({
    zone,
    rows,
    count,
    drag,
    dragRow,
    className,
    children,
}: {
    zone: SideboardZone;
    /** The cards with copies in this zone, in display order. */
    rows: SideboardPoolRow[];
    count: number;
    drag: SideboardDrag | null;
    dragRow?: SideboardPoolRow;
    className?: string;
    children: ReactNode;
}) {
    const sectionRef = useRef<HTMLElement>(null);
    const rowIds = useMemo(() => rows.map((r) => r.cardId), [rows]);
    useRowFocusFallback(sectionRef, rowIds, () =>
        sectionRef.current
            ?.closest<HTMLElement>('[data-slot="game-dialog-column"]')
            ?.querySelector<HTMLElement>('[data-slot="dialog-title"]')
    );
    return (
        <SideboardDropZone
            zone={zone}
            drag={drag}
            row={dragRow}
            className={className}
        >
            <section
                ref={sectionRef}
                aria-label={zoneName(zone)}
                className="h-full overflow-y-auto py-3 pr-4 pl-3 sm:px-5"
            >
                <SideboardZoneLabel count={count}>
                    {zoneName(zone)}
                </SideboardZoneLabel>
                {children}
            </section>
        </SideboardDropZone>
    );
}
