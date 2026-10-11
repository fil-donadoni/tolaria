import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import EmptyState from "~/components/ui/empty-state";
import LimitedEventListItem from "../limited-event-list-item";

/** "Join a table": the tables the viewer can still take a seat at, each with
 *  seat dots, free seats and Join. */
export default function LimitedHubJoinTable({
    events,
    title,
    onJoin,
    onOpen,
    joinPendingEventId,
    emptyMessage,
}: {
    events: LimitedEventSummaryView[];
    title: string;
    onJoin: (eventId: Id<"limitedEvents">) => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
    joinPendingEventId: Id<"limitedEvents"> | null;
    emptyMessage: string;
}) {
    return (
        <section
            aria-labelledby="hub-join"
            className="flex min-w-0 flex-col gap-3"
        >
            <h2 id="hub-join" className="font-display text-lg text-parchment">
                {title}
            </h2>
            {events.length === 0 ? (
                <EmptyState message={emptyMessage} />
            ) : (
                <div className="flex flex-col gap-2">
                    {events.map((event) => {
                        const id = event._id as Id<"limitedEvents">;
                        return (
                            <LimitedEventListItem
                                key={event._id}
                                event={event}
                                viewerHasSeat={false}
                                onJoin={() => onJoin(id)}
                                onOpen={() => onOpen(id)}
                                joinPending={joinPendingEventId === id}
                            />
                        );
                    })}
                </div>
            )}
        </section>
    );
}
