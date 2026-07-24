import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedReviewSeat from "./limited-review-seat";

/** "Review the Table" — the post-completion summary surface (PRD #1107 story
 *  26, issue #1116; redesigned issue #1583). Once an event is `completed`
 *  (every seat has a Deck, `convex/limited/completion.ts`), this renders one
 *  compact summary row per seat (colors + maindeck/sideboard counts). The full
 *  deck list + pick order is admin-only debug detail, collapsed behind a
 *  per-seat disclosure (`LimitedReviewSeat`) — the server projection only
 *  sends another seat's pool/deck contents to an admin. Renders nothing before
 *  completion; the caller doesn't need to gate on `event.completed` itself. */
export default function LimitedReviewPanel({
    event,
    isAdmin,
}: {
    event: LimitedEventView;
    isAdmin: boolean;
}) {
    if (!event.completed) return null;

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Review the Table
            </h3>
            <p className="mb-3 text-xs text-text-muted">
                {isAdmin
                    ? "Every seat, at a glance. Expand a seat for its deck list and pick order."
                    : "Every seat's deck, at a glance."}
            </p>
            <div className="flex flex-col gap-3">
                {event.seats.map((seat) => (
                    <LimitedReviewSeat
                        key={seat.seatIndex}
                        seat={seat}
                        eventType={event.type}
                        isAdmin={isAdmin}
                    />
                ))}
            </div>
        </div>
    );
}
