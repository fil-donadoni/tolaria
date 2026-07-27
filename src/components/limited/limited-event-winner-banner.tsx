import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { isEventConcluded } from "@convex/limited/eventStatus";
import { Banner } from "~/components/ui/banner";

/** Names the event's winner once it has concluded (PRD #1628 story 40, issue
 *  #1646). Standings are DERIVED, never stored (ADR 0076), and already sorted
 *  server-side — points desc, then game-win % desc, then opponent match-win %
 *  desc (`computeStandings`'s own doc comment) — so the winner is simply
 *  `event.standings[0]`, never re-sorted or re-derived here.
 *
 *  Rendered only once `isEventConcluded(event.status)` — a phase QUESTION,
 *  never a literal `status === "finished"` comparison (ADR 0076 decision 1) —
 *  and only once at least one round has actually been decided (an event
 *  cannot conclude with zero standings rows, but this guards the type
 *  regardless of how it got there). */
export default function LimitedEventWinnerBanner({
    event,
}: {
    event: LimitedEventView;
}) {
    if (!isEventConcluded(event.status) || event.standings.length === 0) {
        return null;
    }

    const winner = event.standings[0];
    const seat = event.seats.find((s) => s.seatIndex === winner.seatIndex);
    const label = seat
        ? (seat.nickname ?? (seat.isBot ? "Bot Drafter" : "Open seat"))
        : `Seat ${winner.seatIndex + 1}`;

    return (
        <Banner tone="success" data-testid="event-winner-banner">
            <span className="font-semibold">{label}</span> won the event —{" "}
            {winner.points} points ({winner.matchWins}-{winner.matchLosses}
            {winner.matchDraws > 0 ? `-${winner.matchDraws}` : ""}).
        </Banner>
    );
}
