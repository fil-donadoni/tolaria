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
import { Button } from "~/components/ui/button";
import LimitedStatusBadge from "~/components/limited/limited-status-badge";
import DashboardLimitedOpenEvents from "./dashboard-limited-open-events";

/** A lobby strip is not the `/limited` browse list (issue #2648): it shows
 *  just enough OPEN events to invite a same-session join, with "Browse /
 *  Create Events" as the escape hatch to the full list. Picked to keep the
 *  strip's height in the same order of magnitude as "Your Current Events"
 *  beside it rather than growing unbounded with every event ever opened. */
const MAX_DASHBOARD_OPEN_EVENTS = 3;

/** The lobby's live Limited footer (issue #1582, restyled from a full-width
 *  Panel to the ADR 0103 §6 FOOTER by issue #2726).
 *
 *  Same job, a quarter of the height: Limited's headline entry point is now a
 *  Mode Tile up in the grid, so the footer is only what is LIVE — the events
 *  the viewer can walk back into (`myCurrentLimitedEvents`, #1578/#1589,
 *  narrowed by #2357) and a short capped list of OPEN events they can seat
 *  into without leaving the lobby (#2648, narrowed CLIENT-SIDE by
 *  `isLimitedEventJoinable`; `openEvents` is the RAW `listOpenLimitedEvents`
 *  output and includes both events the viewer already sits in and fully-seated
 *  ones). No new query on either side.
 *
 *  Two escape hatches survive the restyle, in the footer's own header row:
 *  "Browse / Create Events" (→ the events page; creation itself stays out of
 *  scope for the lobby, #1582) and "Your Events (all)" (→ the full list, where
 *  a concluded event lives with its final match record).
 *
 *  It is a `<section>` with an `<h2>`, not a `Panel`: a footer strip laid over
 *  the deck-art ambient should read as the page's own last band, and stacking
 *  a bordered material box under two Deck Shelves is exactly the "web page"
 *  rhythm ADR 0103 §6 replaces. */
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

    // The joinable subset (issue #2648). Newest first (matches
    // `createLimitedEvent`'s own biggest-signal-first convention elsewhere in
    // Limited), capped to `MAX_DASHBOARD_OPEN_EVENTS`.
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
        <section
            aria-labelledby="lobby-limited-footer"
            className="flex flex-col gap-2"
        >
            <div className="flex flex-wrap items-center gap-2">
                <h2
                    id="lobby-limited-footer"
                    className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted"
                >
                    Limited
                </h2>
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={onBrowse}>
                    Browse / Create Events
                </Button>
                <Button variant="ghost" size="sm" onClick={onViewAllEvents}>
                    Your Events (all)
                </Button>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
                {hasOwnEvents && (
                    <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-disabled">
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
                                        type="button"
                                        onClick={() => onOpen(id)}
                                        className={cn(
                                            "flex items-center justify-between gap-2 rounded-sm border px-3 py-2 text-sm transition",
                                            isPrimary
                                                ? "border-accent bg-accent/10 text-text"
                                                : "border-[var(--hairline)] bg-surface/70 text-text hover:border-[var(--hairline-strong)]"
                                        )}
                                    >
                                        <span className="flex min-w-0 items-center gap-2 font-medium">
                                            {isPrimary && (
                                                <span
                                                    aria-hidden
                                                    data-live-dot
                                                    className="size-2 shrink-0 animate-pulse rounded-full bg-danger"
                                                />
                                            )}
                                            <span className="truncate">
                                                {limitedEventName(event)}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2">
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
            </div>

            {!hasOwnEvents && !hasJoinableEvents && (
                <p className="text-xs text-text-muted">
                    No events in progress — browse open events or create one to
                    get started.
                </p>
            )}
        </section>
    );
}
