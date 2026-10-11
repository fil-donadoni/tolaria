import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import EmptyState from "~/components/ui/empty-state";
import LimitedHubHistoryTile from "./limited-hub-history-tile";

/** "History": every finished event the viewer sat in, as compact tiles —
 *  the only place finished events appear (PRD #5383). */
export default function LimitedHubHistory({
    events,
    sources,
}: {
    events: LimitedEventSummaryView[];
    sources: readonly PackSourceInfo[];
}) {
    return (
        <section aria-labelledby="hub-history" className="flex flex-col gap-3">
            <h2
                id="hub-history"
                className="font-display text-lg text-parchment"
            >
                History ({events.length})
            </h2>
            {events.length === 0 ? (
                <EmptyState message="No finished events yet." />
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {events.map((event) => (
                        <LimitedHubHistoryTile
                            key={event._id}
                            event={event}
                            sources={sources}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
