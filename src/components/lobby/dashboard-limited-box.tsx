import { useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import {
    isLimitedEventJoinable,
    limitedEventDashboardRank,
    limitedEventStatusHint,
} from "~/lib/limitedEventStatus";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";
import LimitedStatusBadge from "~/components/limited/limited-status-badge";
import DashboardLimitedOpenEvents from "./dashboard-limited-open-events";

/** A lobby strip is not the `/limited` browse list (issue #2648): it shows
 *  just enough OPEN events to invite a same-session join, with "Browse /
 *  Create Events" as the escape hatch to the full list. Picked to keep the
 *  strip's height in the same order of magnitude as "Your Current Events"
 *  above it rather than growing unbounded with every event ever opened. */
const MAX_DASHBOARD_OPEN_EVENTS = 3;

/** First-class Limited box on the lobby dashboard (issue #1582), given equal
 *  visual weight to `DashboardPlayBox` via the SAME shared Panel component
 *  language — no bespoke frame. Offers the primary Limited actions at a
 *  glance: browse/create events (→ the events page — creation itself stays
 *  out of scope for the dashboard, issue #1582), quick re-entry into every
 *  event STILL IN PROGRESS where the viewer occupies a Seat (each with a
 *  status hint — open/drafting/deckbuilding/ready to play/playing —
 *  `limitedEventStatusHint` — and a link to its event detail), and (issue
 *  #2648, ADR 0101 §9 "open events joinable inline") a short, capped list of
 *  OPEN events the viewer can seat into without leaving the lobby. The
 *  re-entry list reuses `myCurrentLimitedEvents`/`useMyCurrentLimitedEvents`
 *  (issue #1578/#1589, narrowed by #2357); the joinable list reuses
 *  `listOpenLimitedEvents`/`useOpenLimitedEvents` (already the `/limited`
 *  lobby's own source) narrowed CLIENT-SIDE by `isLimitedEventJoinable` —
 *  no new query. A concluded event drops off the re-entry list and lives on
 *  `/limited/events` (`onViewAllEvents`) instead, with its final match
 *  record. */
export default function DashboardLimitedBox({
    events,
    openEvents,
    onBrowse,
    onOpen,
    onJoin,
    joinPendingEventId,
    onViewAllEvents,
}: {
    events: LimitedEventSummaryView[];
    openEvents: LimitedEventSummaryView[];
    onBrowse: () => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
    onJoin: (eventId: Id<"limitedEvents">) => void;
    joinPendingEventId: Id<"limitedEvents"> | null;
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

    // The joinable subset (issue #2648): excludes an event the viewer is
    // already seated in AND an event with no free Seat left, per
    // `isLimitedEventJoinable` — `openEvents` alone (raw `listOpenLimitedEvents`
    // output) is NOT this list, it is every "open"-status event including
    // both of those. Newest first (matches `createLimitedEvent`'s own
    // biggest-signal-first convention elsewhere in Limited), capped to
    // `MAX_DASHBOARD_OPEN_EVENTS` — "Browse / Create Events" above is the
    // escape hatch to the rest.
    const joinableEvents = useMemo(
        () =>
            [...openEvents]
                .filter(isLimitedEventJoinable)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, MAX_DASHBOARD_OPEN_EVENTS),
        [openEvents]
    );

    const hasOwnEvents = sortedEvents.length > 0;
    const hasJoinableEvents = joinableEvents.length > 0;

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

                {hasOwnEvents && (
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
                )}

                {hasJoinableEvents && (
                    <DashboardLimitedOpenEvents
                        events={joinableEvents}
                        onJoin={onJoin}
                        joinPendingEventId={joinPendingEventId}
                    />
                )}

                {!hasOwnEvents && !hasJoinableEvents && (
                    <p className="text-xs text-text-muted">
                        No events in progress — browse open events or create one
                        to get started.
                    </p>
                )}
            </PanelBody>
        </Panel>
    );
}
