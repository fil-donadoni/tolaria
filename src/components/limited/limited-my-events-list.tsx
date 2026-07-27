import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import LimitedEventListItem from "./limited-event-list-item";

/** "Your events" section (issue #1578): every event — open, started, or
 *  completed — where the viewer occupies a Seat, backed by `myLimitedEvents`
 *  (`useMyLimitedEvents`). `listOpenLimitedEvents`/`LimitedEventList` only
 *  ever shows "open" events, so once an event starts it drops off that list
 *  entirely — this is the only in-app way back to it short of a bookmarked
 *  or shared URL. Renders nothing when the viewer has no seated events (no
 *  empty-state banner needed alongside the open-events list already on the
 *  page). */
export default function LimitedMyEventsList({
    events,
    onOpen,
}: {
    events: LimitedEventSummaryView[];
    onOpen: (eventId: Id<"limitedEvents">) => void;
}) {
    if (events.length === 0) return null;

    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Your Events
            </h3>
            {events.map((event) => {
                const id = event._id as Id<"limitedEvents">;
                return (
                    <LimitedEventListItem
                        key={event._id}
                        event={event}
                        viewerHasSeat
                        onOpen={() => onOpen(id)}
                    />
                );
            })}
        </div>
    );
}
