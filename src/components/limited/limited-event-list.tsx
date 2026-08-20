import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import EmptyState from "~/components/ui/empty-state";
import LimitedEventListItem from "./limited-event-list-item";

/** The open-events lobby list (PRD #1107 story 7). */
export default function LimitedEventList({
    events,
    viewerId,
    onJoin,
    onOpen,
    joinPendingEventId,
}: {
    events: LimitedEventSummaryView[];
    viewerId: string;
    onJoin: (eventId: Id<"limitedEvents">) => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
    joinPendingEventId: Id<"limitedEvents"> | null;
}) {
    if (events.length === 0) {
        return <EmptyState message="No open Limited Events right now." />;
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
