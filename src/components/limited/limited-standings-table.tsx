import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedStandingsRow, {
    STANDINGS_COLUMNS,
} from "./limited-standings-row";

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
 *  (`seat.isViewer`, the same per-seat wire flag the table ring already
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
                    className="hidden min-w-[34rem] items-center gap-x-2 border-b border-border-subtle/40 bg-surface-elevated px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:grid"
                    style={{ gridTemplateColumns: STANDINGS_COLUMNS }}
                >
                    <span className="text-center">#</span>
                    <span>Player</span>
                    <span className="text-right">Pts</span>
                    <span className="text-right">Record</span>
                    <span className="text-right">GW%</span>
                    <span>OMW%</span>
                </div>
                {event.standings.map((row, index) => (
                    <LimitedStandingsRow
                        key={row.seatIndex}
                        row={row}
                        rank={index + 1}
                        seat={event.seats.find(
                            (s) => s.seatIndex === row.seatIndex
                        )}
                    />
                ))}
            </div>
        </div>
    );
}
