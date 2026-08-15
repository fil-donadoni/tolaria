import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";
import LimitedStatusBadge from "~/components/limited/limited-status-badge";

/** First-class Limited box on the lobby dashboard (issue #1582), given equal
 *  visual weight to `DashboardPlayBox` via the SAME shared Panel component
 *  language — no bespoke frame. Offers the primary Limited actions at a
 *  glance: browse/create events (→ the events page — creation itself stays
 *  out of scope for the dashboard, issue #1582), and quick re-entry into
 *  every event STILL IN PROGRESS where the viewer occupies a Seat, each with
 *  a status hint (open/drafting/deckbuilding/ready to play/playing —
 *  `limitedEventStatusHint`) and a link to its event detail. The re-entry
 *  list reuses `myCurrentLimitedEvents`/`useMyCurrentLimitedEvents` (issue
 *  #1578/#1589, narrowed by #2357) rather than a new query — a concluded
 *  event drops off this box and lives on `/limited/events`
 *  (`onViewAllEvents`) instead, with its final match record. */
export default function DashboardLimitedBox({
    events,
    onBrowse,
    onOpen,
    onViewAllEvents,
}: {
    events: LimitedEventSummaryView[];
    onBrowse: () => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
    onViewAllEvents: () => void;
}) {
    return (
        <Panel tone="accent" className="flex flex-col">
            <PanelHeader title="Limited" />
            <PanelBody>
                <p className="text-sm text-text-muted">
                    Draft or Sealed, against other players or the Bot Drafter —
                    build a Pool, then a deck.
                </p>

                <div className="flex flex-wrap gap-2">
                    <ActionButton
                        onClick={onBrowse}
                        label="Browse / Create Events"
                        tone="primary"
                    />
                    <ActionButton
                        onClick={onViewAllEvents}
                        label="Your Events (all)"
                        tone="secondary"
                    />
                </div>

                {events.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Your Current Events
                        </p>
                        <div className="flex flex-col gap-2">
                            {events.map((event) => {
                                const id = event._id as Id<"limitedEvents">;
                                return (
                                    <button
                                        key={event._id}
                                        onClick={() => onOpen(id)}
                                        className={cn(
                                            "flex items-center justify-between rounded-sm border px-4 py-2 text-sm transition",
                                            "border-border-subtle bg-surface-elevated text-text hover:border-border-accent/60"
                                        )}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            {limitedEventName(event)}
                                        </span>
                                        <LimitedStatusBadge event={event} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-text-muted">
                        No events in progress — browse open events or create one
                        to get started.
                    </p>
                )}
            </PanelBody>
        </Panel>
    );
}
