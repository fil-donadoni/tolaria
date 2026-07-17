import { useState } from "react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventSeatList from "./limited-event-seat-list";

/** Collapsible "Seats" section shown while a Draft is in progress (PRD #1107,
 *  ADR 0054/0055). During the pick phase the per-seat roster is noise — the
 *  drafter is watching the Booster, not the table — so it collapses behind a
 *  compact summary (seat count + decks-in progress) and stays closed by
 *  default. Outside an active draft (open events, Sealed, a finished draft)
 *  the roster renders inline instead — see `LimitedEventDetail`. */
export default function LimitedEventSeatsDisclosure({
    event,
}: {
    event: LimitedEventView;
}) {
    const [open, setOpen] = useState(false);
    const summary = event.completed
        ? "every seat has a deck"
        : `${event.seatsWithDeck}/${event.seatCount} decks in`;

    return (
        <div className="rounded-sm border border-border-subtle/30">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-text-muted transition hover:text-text"
            >
                <span className="font-semibold">Seats · {event.seatCount}</span>
                <span className="flex items-center gap-2 text-text-disabled">
                    {summary}
                    <span
                        className={`transition-transform ${open ? "rotate-90" : ""}`}
                        aria-hidden
                    >
                        ▸
                    </span>
                </span>
            </button>
            {open && (
                <div className="border-t border-border-subtle/30 p-3">
                    <LimitedEventSeatList event={event} />
                </div>
            )}
        </div>
    );
}
