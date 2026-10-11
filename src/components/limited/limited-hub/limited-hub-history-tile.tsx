import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { formatLimitedMatchRecord } from "~/lib/limitedEventStatus";
import { packSourceForEvent } from "~/lib/limited/limitedHub";
import LimitedHubArt from "./limited-hub-art";

/** One finished event as a compact tile: art, name, the viewer's record and
 *  the date. Opens the event (its standings). */
export default function LimitedHubHistoryTile({
    event,
    sources,
}: {
    event: LimitedEventSummaryView;
    sources: readonly PackSourceInfo[];
}) {
    const navigate = useNavigate();
    const record = formatLimitedMatchRecord(event.viewerMatchRecord);
    return (
        <button
            type="button"
            data-limited-event-label={event.label}
            data-hub-tile="history"
            onClick={() =>
                void navigate({
                    to: "/limited/$eventId",
                    params: { eventId: event._id as Id<"limitedEvents"> },
                })
            }
            className="relative isolate flex min-h-24 flex-col justify-end gap-0.5 overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface p-3 text-left hover:border-accent/60"
        >
            <LimitedHubArt source={packSourceForEvent(event, sources)} />
            <span className="text-sm font-medium text-parchment">
                {limitedEventName(event)}
            </span>
            <span className="text-xs text-text-muted">
                {record ?? "No games"} ·{" "}
                {new Date(event.updatedAt).toLocaleDateString()}
            </span>
        </button>
    );
}
