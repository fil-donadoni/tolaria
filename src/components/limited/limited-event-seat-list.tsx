import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventSeatRow from "./limited-event-seat-row";

/** Every Seat on a Limited Event, in seat order (PRD #1107, ADR 0054/0055). */
export default function LimitedEventSeatList({
    event,
}: {
    event: LimitedEventView;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            {event.seats.map((seat) => (
                <LimitedEventSeatRow key={seat.seatIndex} seat={seat} />
            ))}
        </div>
    );
}
