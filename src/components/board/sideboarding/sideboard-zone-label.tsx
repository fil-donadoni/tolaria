import type { ReactNode } from "react";

/** A zone's heading with its live copy count ("MAINDECK 60"). */
export default function SideboardZoneLabel({
    children,
    count,
}: {
    children: ReactNode;
    count: number;
}) {
    return (
        <div className="mb-2 flex items-baseline gap-2 text-xs uppercase tracking-[0.18em] text-text-muted">
            {children}
            <span
                data-zone-count
                className="text-sm font-semibold tracking-normal text-parchment tabular-nums"
            >
                {count}
            </span>
        </div>
    );
}
