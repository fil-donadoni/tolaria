import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import EmptyState from "~/components/ui/empty-state";
import LimitedEventListItem from "./limited-event-list-item";

/** The Limited Events list (PRD #1107 story 7; merged with the open-only cut
 *  in issue #2590). `emptyMessage` is a passthrough because the caller now
 *  filters this same list several ways (status chip, mine) and each empty
 *  result means something different — "no open events" reads wrong once the
 *  viewer has narrowed to a status/mine combination that legitimately has no
 *  matches. */
export default function LimitedEventList({
    events,
    viewerId,
    onJoin,
    onOpen,
    joinPendingEventId,
    emptyMessage = "No open Limited Events right now.",
}: {
    events: LimitedEventSummaryView[];
    viewerId: string;
    onJoin: (eventId: Id<"limitedEvents">) => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
    joinPendingEventId: Id<"limitedEvents"> | null;
    emptyMessage?: string;
}) {
    if (events.length === 0) {
        return <EmptyState message={emptyMessage} />;
    }

    return (
        <div className="flex flex-col gap-2">
            {events.map((event) => {
                const id = event._id as Id<"limitedEvents">;
                return (
                    <LimitedEventListItem
                        key={event._id}
                        event={event}
                        viewerHasSeat={event.seats.some(
                            (s) => s.userId === viewerId
                        )}
                        onJoin={() => onJoin(id)}
                        onOpen={() => onOpen(id)}
                        joinPending={joinPendingEventId === id}
                    />
                );
            })}
        </div>
    );
}
