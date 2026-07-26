import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedSeatTile from "./limited-seat-tile";

/** Every Seat on a Limited Event, in seat order (PRD #1107, ADR 0054/0055) —
 *  a responsive GRID of compact tiles rather than one full-width row per seat,
 *  so an 8-seat table reads as a table instead of a scroll. */
export default function LimitedEventSeatList({
    event,
}: {
    event: LimitedEventView;
}) {
    return (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
            {event.seats.map((seat) => (
                <LimitedSeatTile key={seat.seatIndex} seat={seat} />
            ))}
        </div>
    );
}
