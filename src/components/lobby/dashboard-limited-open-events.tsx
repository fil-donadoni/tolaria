import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import ActionButton from "~/components/board/action-button";
import LimitedStatusBadge from "~/components/limited/limited-status-badge";

/** The lobby dashboard's "Open Events" section (issue #2648, ADR 0101 §9:
 *  "open events joinable inline") — the subset of open Limited events the
 *  VIEWER can actually seat into (`isLimitedEventJoinable`, already applied
 *  by the caller), one row each with a primary Join action. Split into its
 *  own file rather than inlined beside `DashboardLimitedBox`'s existing
 *  "Your Current Events" markup (CLAUDE.md: one component per file, no
 *  inline helper): that list's rows are each a single big `<button>` (the
 *  whole row navigates on click); these rows carry TWO independent
 *  interactions — the row itself is inert until joined, Join is its own
 *  control — so they are not the same shape squeezed into one file. */
export default function DashboardLimitedOpenEvents({
    events,
    onJoin,
    joinPendingEventId,
}: {
    events: LimitedEventSummaryView[];
    onJoin: (eventId: Id<"limitedEvents">) => void;
    joinPendingEventId: Id<"limitedEvents"> | null;
}) {
    if (events.length === 0) return null;

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Open Events
            </p>
            <div className="flex flex-col gap-2">
                {events.map((event) => {
                    const id = event._id as Id<"limitedEvents">;
                    return (
                        <div
                            key={event._id}
                            className="flex items-center justify-between rounded-sm border border-border-subtle bg-surface-elevated px-4 py-2 text-sm"
                        >
                            <span className="font-medium text-text">
                                {limitedEventName(event)}
                            </span>
                            <span className="flex items-center gap-2">
                                <LimitedStatusBadge event={event} />
                                <ActionButton
                                    onClick={() => onJoin(id)}
                                    label="Join"
                                    tone="primary"
                                    disabled={joinPendingEventId === id}
                                />
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
