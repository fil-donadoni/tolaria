// PROTOTYPE — throwaway. One seat's avatar: human (initials on a hue disc),
// bot (robot glyph, muted), empty (dashed ring with a plus). The viewer
// gets the accent ring.
import { Bot, Plus } from "lucide-react";
import { cn } from "~/lib/utils";
import type { MockSeat } from "./event-mock";

const SIZE = {
    xs: "size-6 text-[9px]",
    sm: "size-8 text-[11px]",
    md: "size-11 text-sm",
    lg: "size-14 text-base",
} as const;

function hueOf(name: string): number {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
}

export default function SeatAvatar({
    seat,
    size = "md",
    className,
}: {
    seat: MockSeat;
    size?: keyof typeof SIZE;
    className?: string;
}) {
    const base = cn(
        "relative flex shrink-0 items-center justify-center rounded-full font-semibold uppercase select-none",
        SIZE[size],
        className
    );
    if (seat.kind === "empty")
        return (
            <span
                className={cn(
                    base,
                    "border-2 border-dashed border-border-strong/70 bg-surface-base/40 text-text-muted"
                )}
                aria-label="Open seat"
            >
                <Plus className="size-[45%]" aria-hidden />
            </span>
        );
    if (seat.kind === "bot")
        return (
            <span
                className={cn(
                    base,
                    "border border-border-strong bg-surface-elevated text-text-muted"
                )}
                aria-label={`${seat.name} (bot)`}
            >
                <Bot className="size-[52%]" aria-hidden />
            </span>
        );
    const hue = hueOf(seat.name);
    return (
        <span
            className={cn(
                base,
                "text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)]",
                seat.isViewer
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-base"
                    : "ring-1 ring-white/25"
            )}
            style={{
                background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 24%))`,
            }}
            aria-label={seat.name}
        >
            {seat.name.slice(0, 2)}
        </span>
    );
}
