import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";

/** One dot per seat, filled when a human or a Bot holds it. */
export default function LimitedHubSeatDots({
    seats,
}: {
    seats: LimitedEventSummaryView["seats"];
}) {
    return (
        <span className="flex flex-wrap gap-1" aria-hidden="true">
            {seats.map((seat) => (
                <span
                    key={seat.seatIndex}
                    data-seat-dot={
                        seat.userId !== undefined || seat.isBot
                            ? "filled"
                            : "free"
                    }
                    className={cn(
                        "size-2.5 rounded-full border border-accent/60",
                        (seat.userId !== undefined || seat.isBot) && "bg-accent"
                    )}
                />
            ))}
        </span>
    );
}
