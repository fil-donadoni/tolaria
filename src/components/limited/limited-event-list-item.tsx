import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { limitedEventStatusHint } from "~/lib/limitedEventStatus";
import ActionButton from "~/components/board/action-button";
import { Button } from "@/components/ui/button";

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
    event: LimitedEventSummaryView;
    viewerHasSeat: boolean;
    // Optional: the open-events lobby list always supplies it (a seatless
    // viewer can Join); the "your events" list (issue #1578) never renders
    // the Join button in the first place (`viewerHasSeat` is always true
    // there), so it has nothing to pass.
    onJoin?: () => void;
    onOpen: () => void;
    joinPending?: boolean;
}) {
    const filledSeats = event.seats.filter(
        (s) => s.userId !== undefined || s.isBot
    ).length;
    // The derived PHASE, never the raw `status` enum (ADR 0076): with the play
    // phase the status union has four members, and the old
    // `completed ? "completed" : status` would have reported a running event
    // as "completed" (every seat has a deck by then, by construction) instead
    // of "playing". `limitedEventStatusHint` is the one authority — the same
    // one `LimitedStatusBadge` renders.
    const statusLabel = limitedEventStatusHint(event);

    return (
        <div className="flex items-center justify-between rounded-sm border border-border-subtle/40 px-4 py-3">
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text">
                    {limitedEventName(event)}
                </span>
                <span className="text-xs text-text-muted">
                    {filledSeats}/{event.seatCount} seats filled · {statusLabel}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onOpen}>
                    View
                </Button>
                {!viewerHasSeat && onJoin && (
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
