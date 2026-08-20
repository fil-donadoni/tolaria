import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";

/** The table at a glance, as a row of small avatar chips (issue #2590) —
 *  replaces the full seat-tile grid (`LimitedEventSeatList`) as the
 *  antechamber's DEFAULT view. The full detail (who is passing to whom, pool
 *  counts) lives one click away in `LimitedTableRing`'s dialog; this row is
 *  only "who is sitting here", which is what the page needs at rest. */
export default function LimitedTableAvatarRow({
    seats,
}: {
    seats: LimitedEventSeatView[];
}) {
    const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);

    return (
        <div
            className="flex flex-wrap items-center gap-1.5"
            aria-label="Table seats"
        >
            {ordered.map((seat) => {
                const isOccupied = seat.userId !== undefined || seat.isBot;
                const label = seat.isBot
                    ? (seat.nickname ?? "Bot Drafter")
                    : (seat.nickname ?? "Open seat");
                const initials = isOccupied
                    ? label.slice(0, 2).toUpperCase()
                    : "–";

                return (
                    <span
                        key={seat.seatIndex}
                        title={`Seat ${seat.seatIndex + 1} — ${label}`}
                        className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tracking-wide uppercase",
                            seat.isViewer
                                ? "border-accent/50 bg-accent/10 text-accent-strong"
                                : isOccupied
                                  ? "border-border-subtle/50 bg-surface-raised text-text-muted"
                                  : "border-dashed border-border-subtle/40 text-text-disabled"
                        )}
                    >
                        {initials}
                    </span>
                );
            })}
        </div>
    );
}
