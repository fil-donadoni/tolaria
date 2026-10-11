import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useJoinLimitedEvent,
    useLimitedEventMutations,
    useMyLimitedEvents,
    useOpenLimitedEvents,
    usePackSources,
    type LimitedEventSummaryView,
} from "~/hooks/useLimitedEvent";
import { useLimitedAgain } from "~/hooks/useLimitedAgain";
import { canCreateLimitedEvents } from "~/lib/limitedGating";
import {
    formatLimitedMatchRecord,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";
import { buildHub } from "~/lib/limited/limitedHub";
import { Banner } from "@/components/ui/banner";
import LoadingScreen from "~/components/ui/loading-screen";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import LimitedHubHistory from "./limited-hub/limited-hub-history";
import LimitedHubJoinTable from "./limited-hub/limited-hub-join-table";
import LimitedHubNewEventTile from "./limited-hub/limited-hub-new-event-tile";
import LimitedHubResultsStrip from "./limited-hub/limited-hub-results-strip";
import LimitedHubYourEvents from "./limited-hub/limited-hub-your-events";
import LimitedStatusFilterBar from "./limited-status-filter-bar";

const NO_SOURCES: never[] = [];

/** The Limited hub, `/limited` (PRD #1107, ADR 0054/0055; reshaped by PRD
 *  #5383 / issue #5388): "Your events" first — one art tile per event the
 *  viewer is in, each with the one action its phase calls for, and a New
 *  event tile always last — then "Join a table", status chips with counts and
 *  History. With no event in progress the New event tile sits beside the
 *  joinable tables under "Start or join a table".
 *
 *  Data union: the viewer can only ever see an OPEN event they haven't
 *  joined (anyone can, via `listOpenLimitedEvents`) or one they occupy a Seat
 *  in at any phase (`myLimitedEvents`) — there is no "browse every event
 *  regardless of phase and ownership" query, by design (a Sealed/Draft Pool
 *  is private). The hub is exactly that union, deduplicated by id. */
export default function LimitedEventsPage({
    status,
    label,
    onStatusChange,
}: {
    status: LimitedEventStatusChip | undefined;
    /** Fixture-label PREFIX (issue #2822, `?label=` — see `src/router.tsx`).
     *  Undefined for every real visit; the `check:ui` lane's list walks pass
     *  `ui-gate/` so their row set is the seeded fixture's and nothing
     *  else. */
    label: string | undefined;
    onStatusChange: (next: LimitedEventStatusChip | undefined) => void;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const openEvents = useOpenLimitedEvents();
    const myEvents = useMyLimitedEvents();
    const packSources = usePackSources();
    const { join } = useLimitedEventMutations();
    const again = useLimitedAgain(packSources);

    const viewerId = user?._id ?? "";

    // `handleOpen` is defined here (not further below with the other
    // handlers) purely so the Rules of Hooks are satisfied: `useJoinLimitedEvent`
    // is a hook and must run unconditionally, before the loading early-return
    // just below, so its `onJoined` callback must already be initialized.
    const handleOpen = (eventId: Id<"limitedEvents">) => {
        void navigate({
            to: "/limited/$eventId",
            params: { eventId },
        });
    };

    // Shared with the lobby dashboard's inline Join affordance (issue #2648)
    // — single in-flight guard, error surfaced, navigate to the event on
    // success. See `useJoinLimitedEvent`'s own doc comment.
    const { handleJoin, joinPendingEventId, joinError } = useJoinLimitedEvent(
        join,
        handleOpen
    );

    // Union by id — `myEvents` wins on overlap (it carries the viewer's own
    // match record; `openEvents` never does, since an open event has no play
    // phase yet anyway, but this keeps the merge rule obvious either way).
    const merged = useMemo((): LimitedEventSummaryView[] => {
        if (openEvents === undefined || myEvents === undefined) return [];
        const byId = new Map<string, LimitedEventSummaryView>();
        for (const event of openEvents) byId.set(event._id, event);
        for (const event of myEvents) byId.set(event._id, event);
        return [...byId.values()];
    }, [openEvents, myEvents]);

    const hub = useMemo(
        () => buildHub(merged, viewerId, status, label),
        [merged, viewerId, status, label]
    );

    if (
        openEvents === undefined ||
        myEvents === undefined ||
        user === undefined
    ) {
        return <LoadingScreen />;
    }

    const sources = packSources ?? NO_SOURCES;
    const canCreate = canCreateLimitedEvents(user);
    const showHistory = status === "history";
    const hasYours = hub.yours.length > 0;
    const filtered = status !== undefined;

    const newEventTile = (
        <LimitedHubNewEventTile
            again={again.again}
            summary={again.summary}
            busy={again.busy}
            error={again.error}
            onAgain={() => void again.start()}
        />
    );

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
            <SurfaceReadyMarker />
            <header className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="font-display text-2xl text-parchment">
                    Limited Events
                </h1>
                <LimitedStatusFilterBar
                    value={status}
                    counts={hub.counts}
                    onChange={onStatusChange}
                />
            </header>
            {joinError && <Banner tone="danger">{joinError}</Banner>}

            {showHistory ? (
                <LimitedHubHistory events={hub.history} sources={sources} />
            ) : (
                <>
                    {hasYours || filtered ? (
                        <>
                            <LimitedHubYourEvents
                                events={hub.yours}
                                sources={sources}
                                canCreate={canCreate}
                                again={again.again}
                                summary={again.summary}
                                busy={again.busy}
                                error={again.error}
                                onAgain={() => void again.start()}
                            />
                            <LimitedHubJoinTable
                                title="Join a table"
                                events={hub.joinable}
                                onJoin={(id) => void handleJoin(id)}
                                onOpen={handleOpen}
                                joinPendingEventId={joinPendingEventId}
                                emptyMessage={
                                    filtered
                                        ? "No tables match this filter."
                                        : "No open tables right now."
                                }
                            />
                        </>
                    ) : (
                        <section
                            aria-label="Start or join a table"
                            className="flex flex-col gap-3"
                        >
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                {canCreate && (
                                    <div className="lg:col-span-1">
                                        {newEventTile}
                                    </div>
                                )}
                                <div className="lg:col-span-2">
                                    <LimitedHubJoinTable
                                        title="Start or join a table"
                                        events={hub.joinable}
                                        onJoin={(id) => void handleJoin(id)}
                                        onOpen={handleOpen}
                                        joinPendingEventId={joinPendingEventId}
                                        emptyMessage="No open tables right now."
                                    />
                                </div>
                            </div>
                        </section>
                    )}
                    <LimitedHubResultsStrip
                        count={hub.history.length}
                        latestRecord={formatLimitedMatchRecord(
                            hub.history[0]?.viewerMatchRecord
                        )}
                        onOpenHistory={() => onStatusChange("history")}
                    />
                </>
            )}
        </div>
    );
}
