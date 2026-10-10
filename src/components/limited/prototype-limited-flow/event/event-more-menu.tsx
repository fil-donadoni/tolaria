// PROTOTYPE — throwaway. The ⋯ menu: Copy link · Leave seat · Close event.
import { Ellipsis, Link2, LogOut, XCircle } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import type { EventProto } from "./use-event-proto";

export default function EventMoreMenu({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    const seated = p.seats.some((s) => s.isViewer);
    const items = [
        { label: "Copy link", icon: Link2, show: true, danger: false },
        {
            label: "Leave seat",
            icon: LogOut,
            show: seated && !p.started,
            danger: false,
        },
        {
            label: p.started ? "Close event" : "Cancel event",
            icon: XCircle,
            show: p.viewpoint === "creator" && p.phase !== "finished",
            danger: true,
        },
    ].filter((i) => i.show);
    return (
        <Popover>
            <PopoverTrigger
                aria-label="More event actions"
                className={cn(
                    "flex size-9 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-surface-base/70 text-parchment backdrop-blur transition hover:border-accent/60",
                    className
                )}
            >
                <Ellipsis className="size-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-48 p-1">
                {items.map((it) => (
                    <button
                        key={it.label}
                        type="button"
                        onClick={() => p.log(it.label)}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-surface-elevated",
                            it.danger ? "text-danger-strong" : "text-text"
                        )}
                    >
                        <it.icon className="size-4" />
                        {it.label}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}
