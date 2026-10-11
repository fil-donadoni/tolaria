import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import type { LimitedSetup } from "~/lib/limited/limitedSetup";
import { hubTileClasses } from "~/lib/limited/limitedHub";
import LimitedHubEventTile from "./limited-hub-event-tile";
import LimitedHubNewEventTile from "./limited-hub-new-event-tile";

/** "Your events (n)": one art tile per in-progress event, the New event tile
 *  always the LAST (PRD #5383). Fixed row height so tiles align; the layout
 *  classes are `hubTileClasses`' call. */
export default function LimitedHubYourEvents({
    events,
    sources,
    canCreate,
    again,
    summary,
    busy,
    error,
    onAgain,
}: {
    events: LimitedEventSummaryView[];
    sources: readonly PackSourceInfo[];
    canCreate: boolean;
    again: LimitedSetup | null;
    summary: string;
    busy: boolean;
    error: string | null;
    onAgain: () => void;
}) {
    return (
        <section
            aria-labelledby="hub-your-events"
            className="flex flex-col gap-3"
        >
            <h2
                id="hub-your-events"
                className="font-display text-lg text-parchment"
            >
                Your events ({events.length})
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[12rem]">
                {events.map((event, index) => (
                    <LimitedHubEventTile
                        key={event._id}
                        event={event}
                        sources={sources}
                        className={hubTileClasses(index, events.length)}
                    />
                ))}
                {canCreate && (
                    <LimitedHubNewEventTile
                        again={again}
                        summary={summary}
                        busy={busy}
                        error={error}
                        onAgain={onAgain}
                        className={hubTileClasses(events.length, events.length)}
                    />
                )}
            </div>
        </section>
    );
}
