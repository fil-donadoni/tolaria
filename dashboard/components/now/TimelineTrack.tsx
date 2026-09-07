import type { ReactNode } from "react";

/** One lane of the 24-hour strip: its label, and the items positioned on it. */
export function TimelineTrack({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-14 shrink-0 text-[11px]">
                {label}
            </span>
            <div className="bg-muted/40 relative h-6 flex-1 rounded-sm">
                {children}
            </div>
        </div>
    );
}
