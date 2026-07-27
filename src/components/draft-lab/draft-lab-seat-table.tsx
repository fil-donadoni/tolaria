// The 8-seat table view (issue #1612: "table view: all 8 seats, each with
// its current pack and the pick it made").
import type { DraftLabState } from "@/lib/limited/draftLabEngine";
import type { GetCardProfile } from "@convex/limited/cardProfiles";
import DraftLabSeatCard from "./draft-lab-seat-card";

export default function DraftLabSeatTable({
    state,
    focusedSeat,
    onFocusSeat,
    getCardProfile,
}: {
    state: DraftLabState;
    focusedSeat: number;
    onFocusSeat: (seatIndex: number) => void;
    getCardProfile: GetCardProfile;
}) {
    // Latest pick log entry per seat — the "pick it made" the table shows.
    const lastPickBySeat = new Map<number, (typeof state.pickLog)[number]>();
    for (const record of state.pickLog) {
        lastPickBySeat.set(record.seatIndex, record);
    }

    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {state.seats.map((seat) => (
                <DraftLabSeatCard
                    key={seat.seatIndex}
                    seat={seat}
                    lastPick={lastPickBySeat.get(seat.seatIndex)}
                    focused={seat.seatIndex === focusedSeat}
                    getCardProfile={getCardProfile}
                    onFocus={() => onFocusSeat(seat.seatIndex)}
                />
            ))}
        </div>
    );
}
