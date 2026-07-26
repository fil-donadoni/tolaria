import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventSeatList from "./limited-event-seat-list";

/** The table at a glance: who is sitting where, and how far the table is
 *  through deck building.
 *
 *  Replaces the old "seat list + a loose `N/seatCount decks in.` sentence"
 *  pair. Once every Pool is final, the deck-in count is the single number the
 *  event is waiting on — so it renders as a labelled progress bar over the
 *  seat grid (each tile carrying its own ready dot), which is the visual
 *  build-state summary a player wants after submitting their own deck.
 *
 *  `showProgress` mirrors `LimitedEventDetail`'s `isPoolFinal` (issue #1580):
 *  a deck cannot exist before the Pool is final, so before that point the
 *  counter would always read 0 and misread as live progress. */
export default function LimitedTablePanel({
    event,
    showProgress,
}: {
    event: LimitedEventView;
    showProgress: boolean;
}) {
    const pct =
        event.seatCount > 0
            ? Math.round((event.seatsWithDeck / event.seatCount) * 100)
            : 0;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Table
                </h3>
                {showProgress && (
                    <span className="text-xs text-text-muted">
                        {event.completed
                            ? "Every seat has a deck"
                            : `${event.seatsWithDeck}/${event.seatCount} decks in`}
                    </span>
                )}
            </div>

            {showProgress && (
                <div
                    className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={event.seatCount}
                    aria-valuenow={event.seatsWithDeck}
                    aria-label="Decks submitted"
                >
                    <div
                        className="h-full bg-success transition-[width]"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}

            <LimitedEventSeatList event={event} />
        </div>
    );
}
