import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";

/** One Seat as a compact tile (was a full-width row per seat — an 8-seat
 *  table cost eight stacked bars of mostly empty space). Everything a player
 *  reads off the table at a glance, in one line: seat number, occupant,
 *  whether their deck is in, and their Pool size.
 *
 *  Graphic, not verbose: readiness is a filled/hollow dot rather than a
 *  "READY" pill (the word survives as screen-reader text and the dot's
 *  `title`, so the state is still announced and still assertable in tests);
 *  a bot is marked by a muted glyph, the viewer by an accent-tinted frame,
 *  an empty seat by a dashed one. Deck CONTENTS are never rendered here —
 *  `hasDeck` is a pure readiness flag (issue #1580) and stays that way. */
export default function LimitedSeatTile({
    seat,
}: {
    seat: LimitedEventSeatView;
}) {
    const isOccupied = seat.userId !== undefined || seat.isBot;
    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");

    return (
        <div
            className={cn(
                "flex items-center gap-2 rounded-sm border px-2 py-1.5 text-xs",
                seat.isViewer
                    ? "border-accent/50 bg-accent/5"
                    : isOccupied
                      ? "border-border-subtle/40"
                      : "border-dashed border-border-subtle/40"
            )}
        >
            <span
                className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border text-[10px] font-semibold tabular-nums",
                    seat.isViewer
                        ? "border-accent/50 text-accent-strong"
                        : "border-border-subtle/50 text-text-muted"
                )}
                title={`Seat ${seat.seatIndex + 1}`}
            >
                {seat.seatIndex + 1}
            </span>

            <span
                className={cn(
                    "min-w-0 flex-1 truncate",
                    isOccupied
                        ? "font-medium text-text"
                        : "text-text-muted italic"
                )}
            >
                {label}
                {seat.isBot && (
                    <span
                        className="ml-1 text-text-disabled"
                        title="Bot Drafter"
                    >
                        ⌁
                    </span>
                )}
            </span>

            {seat.poolCount !== null && (
                <span className="shrink-0 tabular-nums text-text-disabled">
                    {seat.poolCount}
                </span>
            )}

            {isOccupied && (
                <span
                    className={cn(
                        "h-2 w-2 shrink-0 rounded-full border",
                        seat.hasDeck
                            ? "border-success bg-success"
                            : "border-border-subtle/60"
                    )}
                    title={seat.hasDeck ? "Ready" : "Still building"}
                >
                    <span className="sr-only">
                        {seat.hasDeck ? "Ready" : "Still building"}
                    </span>
                </span>
            )}
        </div>
    );
}
