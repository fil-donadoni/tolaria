import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedReviewSeat from "./limited-review-seat";

/** "Review the Table" — the post-mortem study surface (PRD #1107 story 26,
 *  issue #1116): once an event is `completed` (every seat has a Deck,
 *  `convex/limited/completion.ts`), the server projection exposes every
 *  seat's Pool and built Deck to every viewer — this renders that full
 *  disclosure. Renders nothing before completion; the caller doesn't need to
 *  gate on `event.completed` itself. */
export default function LimitedReviewPanel({
    event,
}: {
    event: LimitedEventView;
}) {
    if (!event.completed) return null;

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Review the Table
            </h3>
            <p className="mb-3 text-xs text-text-muted">
                Every seat&apos;s Pool and built Deck is now visible for study.
            </p>
            <div className="flex flex-col gap-3">
                {event.seats.map((seat) => (
                    <LimitedReviewSeat
                        key={seat.seatIndex}
                        seat={seat}
                        eventType={event.type}
                    />
                ))}
            </div>
        </div>
    );
}
