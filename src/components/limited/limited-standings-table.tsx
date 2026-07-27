import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";

const COLUMNS = "minmax(0,1fr) 3rem 5rem 4.5rem 3.5rem 3.5rem";

function formatPct(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/** The standings table (PRD #1628 stories 22-24/47, issue #1643) — one row
 *  per seat, DERIVED at read time from the event's recorded rounds
 *  (`convex/limited/standings.ts`'s `computeStandings`, wired through
 *  `projectLimitedEvent`/`event.standings`) and never stored (ADR 0076).
 *  Sorted server-side (points desc, then game-win % desc, then opponent
 *  match-win % desc) — this component renders `event.standings` in the order
 *  it arrives and never re-sorts.
 *
 *  Renders one zeroed row per seat before any round is decided (issue #1643
 *  AC: "readable for an event with no results yet — zeroed, not crashed or
 *  blank") rather than hiding until the first result lands; the caller
 *  decides WHEN the panel is shown at all (`LimitedEventDetail` gates it on
 *  the play phase having started). The viewer's own seat is highlighted
 *  (`seat.isViewer`, the same per-seat wire flag `LimitedSeatTile` already
 *  uses) — same accent-tint convention, not a re-derived lookup. */
export default function LimitedStandingsTable({
    event,
}: {
    event: LimitedEventView;
}) {
    if (event.standings.length === 0) return null;

    return (
        <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Standings
            </h3>
            <div className="overflow-x-auto rounded-sm border border-border-subtle/40">
                <div
                    className="grid min-w-[32rem] items-center gap-x-2 border-b border-border-subtle/40 bg-surface-elevated px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
                    style={{ gridTemplateColumns: COLUMNS }}
                >
                    <span>Seat</span>
                    <span className="text-right">Pts</span>
                    <span className="text-right">Record</span>
                    <span className="text-right">Games</span>
                    <span className="text-right">GW%</span>
                    <span className="text-right">OMW%</span>
                </div>
                {event.standings.map((row) => {
                    const seat = event.seats.find(
                        (s) => s.seatIndex === row.seatIndex
                    );
                    const label = seat
                        ? (seat.isBot
                              ? (seat.nickname ?? "Bot Drafter")
                              : (seat.nickname ?? "Open seat"))
                        : `Seat ${row.seatIndex + 1}`;
                    return (
                        <div
                            key={row.seatIndex}
                            data-testid="standings-row"
                            data-seat-index={row.seatIndex}
                            data-is-viewer={seat?.isViewer ?? false}
                            className={cn(
                                "grid min-w-[32rem] items-center gap-x-2 border-b border-border-subtle/20 px-2 py-1.5 text-xs last:border-b-0",
                                seat?.isViewer && "bg-accent/5"
                            )}
                            style={{ gridTemplateColumns: COLUMNS }}
                        >
                            <span
                                className={cn(
                                    "min-w-0 truncate",
                                    seat?.isViewer
                                        ? "font-semibold text-accent-strong"
                                        : "text-text"
                                )}
                            >
                                {label}
                            </span>
                            <span className="text-right font-semibold tabular-nums text-text">
                                {row.points}
                            </span>
                            <span className="text-right tabular-nums text-text-muted">
                                {row.matchWins}-{row.matchLosses}
                                {row.matchDraws > 0
                                    ? `-${row.matchDraws}`
                                    : ""}
                            </span>
                            <span className="text-right tabular-nums text-text-muted">
                                {row.gameWins}-{row.gameLosses}
                            </span>
                            <span className="text-right tabular-nums text-text-muted">
                                {formatPct(row.gameWinPct)}
                            </span>
                            <span className="text-right tabular-nums text-text-muted">
                                {formatPct(row.opponentMatchWinPct)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
