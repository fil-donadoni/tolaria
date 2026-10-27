import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { filledSeatCount } from "~/lib/limited/limitedHub";
import { OPEN_DECKLISTS_JOIN_WARNING } from "~/lib/openDecklists";
import ActionButton from "~/components/board/action-button";
import { Button } from "@/components/ui/button";
import LimitedHubSeatDots from "./limited-hub/limited-hub-seat-dots";

/** One table in the hub's "Join a table" section (PRD #1107 story 7, #5388):
 *  the event's name, seat dots, free seats and a Join button, under the
 *  "Waiting for players" badge. An Open Decklists event says so on the row,
 *  and a seatless viewer reads the disclosure beside Join (issue #5386). */
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
    const freeSeats = event.seatCount - filledSeatCount(event);

    return (
        <div
            // The row's stable DOM handle (issue #2822). `key={event._id}` is
            // a React key, not an attribute — nothing in the DOM addressed one
            // specific event before this, which is why `bun run check:ui`'s
            // walks had to pick their subject by LIST POSITION and silently
            // started measuring a different event whenever the deployment
            // gained one. Emitted only for a labelled (seeded) event
            // (`convex/limitedFixtures.ts`); a player-created row has no label
            // and gets no attribute.
            data-limited-event-label={event.label}
            className="flex items-center justify-between rounded-sm border border-border-subtle/40 px-4 py-3"
        >
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text">
                    {limitedEventName(event)}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        Waiting for players
                    </span>
                    <LimitedHubSeatDots seats={event.seats} />
                    {freeSeats} free {freeSeats === 1 ? "seat" : "seats"}
                    {event.openDecklists && " · Open Decklists"}
                </span>
                {event.openDecklists && !viewerHasSeat && onJoin && (
                    <span
                        className="text-xs text-text-muted"
                        data-slot="open-decklists-join-warning"
                    >
                        {OPEN_DECKLISTS_JOIN_WARNING}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={onOpen}>
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
