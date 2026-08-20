import { useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import {
    limitedEventDashboardRank,
    limitedEventStatusHint,
} from "~/lib/limitedEventStatus";
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
    // The live strip surfaces the viewer's own IN-PROGRESS event first (ADR
    // 0101 §9, issue #2591) rather than showing them in query order — a
    // seated event mid-round is what the player almost certainly came back
    // to finish. `Array.prototype.sort` is stable, so ties (several events at
    // the same phase) keep the query's own order.
    const sortedEvents = useMemo(
        () =>
            [...events].sort(
                (a, b) =>
                    limitedEventDashboardRank(a) - limitedEventDashboardRank(b)
            ),
        [events]
    );

    return (
        <Panel tone="accent" className="flex w-full flex-col">
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

                {sortedEvents.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Your Current Events
                        </p>
                        <div className="flex flex-col gap-2">
                            {sortedEvents.map((event, i) => {
                                const id = event._id as Id<"limitedEvents">;
                                // The primary CTA (ADR 0101 §9): the TOP row,
                                // only when it's genuinely in progress — not
                                // merely first alphabetically/by query order.
                                const isPrimary =
                                    i === 0 &&
                                    limitedEventStatusHint(event) === "playing";
                                return (
                                    <button
                                        key={event._id}
                                        onClick={() => onOpen(id)}
                                        className={cn(
                                            "flex items-center justify-between rounded-sm border px-4 py-2 text-sm transition",
                                            isPrimary
                                                ? "border-accent bg-accent/10 text-text hover:border-accent"
                                                : "border-border-subtle bg-surface-elevated text-text hover:border-border-accent/60"
                                        )}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            {isPrimary && (
                                                <span
                                                    aria-hidden
                                                    data-live-dot
                                                    className="size-2 shrink-0 animate-pulse rounded-full bg-danger"
                                                />
                                            )}
                                            {limitedEventName(event)}
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <LimitedStatusBadge event={event} />
                                            {isPrimary && (
                                                <span className="rounded-sm bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-base">
                                                    Continue →
                                                </span>
                                            )}
                                        </span>
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
