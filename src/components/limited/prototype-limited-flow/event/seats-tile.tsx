// PROTOTYPE — throwaway. Waiting: which seats are taken, at a glance — an
// 8-segment bar plus the roster (humans named, open seats explicit).
import { cn } from "~/lib/utils";
import SeatAvatar from "./seat-avatar";
import TileFrame from "./tile-frame";
import type { EventProto } from "./use-event-proto";

export default function SeatsTile({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    const humans = p.seats.filter((s) => s.kind === "human");
    const open = p.seats.length - humans.length;
    return (
        <TileFrame
            title="Seats"
            right={
                <span className="text-xs tabular-nums text-parchment">
                    <b>{humans.length}</b>
                    <span className="text-text-muted">
                        /{p.seats.length} taken
                    </span>
                </span>
            }
            className={className}
        >
            <div className="flex gap-1" aria-hidden>
                {p.seats.map((s) => (
                    <span
                        key={s.seatIndex}
                        className={cn(
                            "h-2 flex-1 rounded-full",
                            s.kind === "human"
                                ? s.isViewer
                                    ? "bg-accent"
                                    : "bg-parchment/80"
                                : "border border-dashed border-border-strong"
                        )}
                    />
                ))}
            </div>
            <ul className="grid grid-cols-2 gap-1.5">
                {p.seats.map((s) => (
                    <li
                        key={s.seatIndex}
                        className={cn(
                            "flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-xs",
                            s.kind === "empty"
                                ? "border border-dashed border-border-strong/60 text-text-muted italic"
                                : "bg-surface-elevated/60 text-parchment"
                        )}
                    >
                        <SeatAvatar seat={s} size="xs" />
                        <span className="truncate">
                            {s.isViewer ? "You" : s.name}
                        </span>
                        {s.isCreator && s.kind === "human" && (
                            <span className="ml-auto text-[9px] uppercase tracking-wide text-accent-strong">
                                host
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            <p className="text-xs text-text-muted">
                {open} open seats — bots take them when the event starts.
            </p>
        </TileFrame>
    );
}
