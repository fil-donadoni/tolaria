import type { ReactNode } from "react";
import type { SideboardDrag } from "~/hooks/useSideboardDrag";
import {
    copiesIn,
    zoneName,
    type SideboardPoolRow,
    type SideboardZone,
} from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";
import SideboardDropPad from "./sideboard-drop-pad";

/** A zone that accepts drops (issue #9820). While a card from the OTHER zone
 *  is dragged it lights up and, for a pile of 2+, offers two pads: "1 copy"
 *  and "All N". */
export default function SideboardDropZone({
    zone,
    drag,
    row,
    className,
    children,
}: {
    zone: SideboardZone;
    drag: SideboardDrag | null;
    /** The dragged card's pool row. */
    row?: SideboardPoolRow;
    className?: string;
    children: ReactNode;
}) {
    const target = !!drag && drag.from !== zone;
    const over = target && drag.over === zone;
    const pile = row && drag ? copiesIn(row, drag.from) : 0;
    const name = zoneName(zone);
    const all = !!drag && (drag.overAll || drag.shift);
    return (
        <div
            data-drop-zone={zone}
            data-drop-target={target ? (over ? "over" : "") : undefined}
            className={cn(
                "relative min-h-0 transition-colors",
                target && "bg-accent-soft/40",
                over && "bg-accent-soft",
                className
            )}
        >
            {children}
            {target && (
                <div
                    className={cn(
                        "pointer-events-none absolute inset-1.5 rounded-lg border-2 border-dashed transition-colors",
                        over ? "border-accent" : "border-accent/40"
                    )}
                />
            )}
            {target && pile > 1 && (
                <div
                    className={cn(
                        "absolute inset-x-3 top-10 z-30 flex flex-col gap-2 sm:inset-x-4",
                        zone === "main" && "sm:flex-row"
                    )}
                >
                    <SideboardDropPad
                        zone={zone}
                        active={over && !all}
                        label={`1 copy → ${name}`}
                    />
                    <SideboardDropPad
                        zone={zone}
                        all
                        active={over && all}
                        label={`All ${pile} → ${name}`}
                    />
                </div>
            )}
        </div>
    );
}
