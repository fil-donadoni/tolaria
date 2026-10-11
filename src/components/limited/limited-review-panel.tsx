import { areOtherSeatsRevealed } from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Banner } from "@/components/ui/banner";
import { OPEN_DECKLISTS_REVIEW_NOTICE } from "~/lib/openDecklists";
import LimitedReviewSeat from "./limited-review-seat";

/** "Review the Table" — the post-completion summary surface (PRD #1107 story
 *  26, issue #1116; redesigned issue #1583). Once an event is `completed`
 *  (every seat has a Deck, `convex/limited/completion.ts`), this renders one
 *  compact summary row per seat (colors + maindeck/sideboard counts), with
 *  the full deck list + pick order behind a per-seat disclosure
 *  (`LimitedReviewSeat`) for every seat the projection reveals: the viewer's
 *  own always, every other once the event is finished, or from the Play
 *  Phase on with Open Decklists (issue #5386 — the SAME
 *  `areOtherSeatsRevealed` the server projection enforces). Renders nothing
 *  before completion; the caller doesn't need to gate on `event.completed`
 *  itself. */
export default function LimitedReviewPanel({
    event,
}: {
    event: LimitedEventView;
}) {
    if (!event.completed) return null;
    const othersRevealed = areOtherSeatsRevealed(
        event.status,
        event.openDecklists
    );

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Review the Table
            </h3>
            <p className="mb-3 text-xs text-text-muted">
                {othersRevealed
                    ? "Every seat, at a glance. Expand a seat for its deck list and pick order."
                    : "Every seat's deck, at a glance. Other seats' deck lists and pick orders are revealed when the event ends."}
            </p>
            {event.openDecklists && othersRevealed && (
                <Banner
                    tone="info"
                    className="mb-3"
                    data-slot="open-decklists-notice"
                >
                    {OPEN_DECKLISTS_REVIEW_NOTICE}
                </Banner>
            )}
            <div className="flex flex-col gap-3">
                {event.seats.map((seat) => (
                    <LimitedReviewSeat
                        key={seat.seatIndex}
                        seat={seat}
                        eventType={event.type}
                        revealed={seat.isViewer || othersRevealed}
                    />
                ))}
            </div>
        </div>
    );
}
