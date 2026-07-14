import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";

/** One Seat row in a Limited Event's Seat list (PRD #1107, ADR 0054/0055).
 *  Shows the occupant (human nickname, Bot Drafter placeholder, or "Open"),
 *  and — once the event has started — the Pool card count. Never renders
 *  Pool contents itself: those are hidden for every seat but the viewer's own
 *  (`LimitedPoolView` reads `pool` directly for that one seat). */
export default function LimitedEventSeatRow({
    seat,
}: {
    seat: LimitedEventSeatView;
}) {
    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");
    const isOccupied = seat.userId !== undefined || seat.isBot;

    return (
        <div className="flex items-center justify-between rounded-sm border border-border-subtle/40 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                    Seat {seat.seatIndex + 1}
                </span>
                <span
                    className={
                        isOccupied
                            ? "font-medium text-text"
                            : "text-text-muted italic"
                    }
                >
                    {label}
                </span>
                {seat.isBot && (
                    <span className="rounded-sm border border-border-subtle/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                        Bot
                    </span>
                )}
                {seat.isViewer && (
                    <span className="rounded-sm border border-accent/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-strong">
                        You
                    </span>
                )}
            </div>
            {seat.poolCount !== null && (
                <span className="text-xs text-text-muted">
                    {seat.poolCount} card{seat.poolCount === 1 ? "" : "s"}
                </span>
            )}
        </div>
    );
}
