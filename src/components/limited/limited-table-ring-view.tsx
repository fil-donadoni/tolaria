import { ArrowRight } from "lucide-react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import {
    passArrows,
    placeSeatsOnRing,
    ringPhaseFacts,
    seatRecord,
} from "~/lib/limitedTableRing";
import LimitedTableRingSeat from "./limited-table-ring-seat";

/** The table as a ring of seats, the viewer at the bottom (prototype event
 *  variant A, issue #5390). Placement and arrows are pure geometry in
 *  `~/lib/limitedTableRing`; the seat order is the Draft's own adjacency.
 *  While drafting, arrows show which way the CURRENT round's packs travel
 *  (`round` → the server's `passDirection`). Mounted inline from `md` up and
 *  inside the table dialog below it / in the Draft Room. */
export default function LimitedTableRingView({
    event,
    round,
}: {
    event: LimitedEventView;
    round: number;
}) {
    const facts = ringPhaseFacts(event);
    const viewerSeat = event.seats.find((s) => s.isViewer);
    const slots = placeSeatsOnRing(
        event.seats.map((s) => s.seatIndex),
        viewerSeat?.seatIndex
    );
    const arrows = facts.showQueued ? passArrows(slots, round) : [];

    return (
        <div
            data-slot="table-ring"
            role="list"
            aria-label="Draft table"
            tabIndex={0}
            className="relative mx-auto aspect-[4/3] min-h-64 w-full max-w-xl"
        >
            {arrows.map((arrow) => (
                <ArrowRight
                    key={arrow.fromSeatIndex}
                    data-slot="pass-arrow"
                    data-from={arrow.fromSeatIndex}
                    data-to={arrow.toSeatIndex}
                    aria-hidden="true"
                    className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-text-disabled"
                    style={{
                        left: `${arrow.x}%`,
                        top: `${arrow.y}%`,
                        transform: `translate(-50%, -50%) rotate(${arrow.rotation}deg)`,
                    }}
                />
            ))}
            {event.seats.map((seat) => {
                const slot = slots.find((s) => s.seatIndex === seat.seatIndex)!;
                return (
                    <div
                        key={seat.seatIndex}
                        role="listitem"
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                    >
                        <LimitedTableRingSeat
                            seat={seat}
                            facts={facts}
                            record={
                                facts.showRecord
                                    ? seatRecord(event, seat.seatIndex)
                                    : null
                            }
                        />
                    </div>
                );
            })}
        </div>
    );
}
