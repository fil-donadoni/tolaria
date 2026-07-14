import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import ActionButton from "~/components/board/action-button";

/** One row in the open-events lobby list (PRD #1107 story 7). Shows the
 *  event's type, filled/total seat count, and Pack Source, with a Join button
 *  when the viewer hasn't already taken a seat. */
export default function LimitedEventListItem({
    event,
    viewerHasSeat,
    onJoin,
    onOpen,
    joinPending = false,
}: {
    event: LimitedEventView;
    viewerHasSeat: boolean;
    onJoin: () => void;
    onOpen: () => void;
    joinPending?: boolean;
}) {
    const filledSeats = event.seats.filter(
        (s) => s.userId !== undefined || s.isBot
    ).length;

    return (
        <div className="flex items-center justify-between rounded-sm border border-border-subtle/40 px-4 py-3">
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium capitalize text-text">
                    {event.type} — {event.packSlots.join(", ").toUpperCase()}
                </span>
                <span className="text-xs text-text-muted">
                    {filledSeats}/{event.seatCount} seats filled
                </span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={onOpen}
                    className="btn-base btn-tone-secondary px-3 py-1.5 text-xs"
                >
                    View
                </button>
                {!viewerHasSeat && (
                    <ActionButton
                        onClick={onJoin}
                        label="Join"
                        tone="primary"
                        disabled={joinPending}
                    />
                )}
            </div>
        </div>
    );
}
