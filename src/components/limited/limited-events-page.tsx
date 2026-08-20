import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useDraftableSets,
    useLimitedEventMutations,
    useMyLimitedEvents,
    useOpenLimitedEvents,
    type LimitedEventSummaryView,
} from "~/hooks/useLimitedEvent";
import { canCreateLimitedEvents } from "~/lib/limitedGating";
import {
    limitedEventStatusChip,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import LimitedEventList from "./limited-event-list";
import LimitedStatusFilterBar from "./limited-status-filter-bar";
import CreateLimitedEventDialog, {
    type CreateLimitedEventPayload,
} from "./create-limited-event-dialog";

/** Limited Events lobby (PRD #1107, ADR 0054/0055, issue #1110; merged with
 *  the your-events page and given status/mine filtering by issue #2590): the
 *  ONE list — open events plus every event the viewer has ever sat in
 *  (in progress and concluded), status-chip and "mine" filtered, with Join
 *  inline. `/limited/events` used to be the only place a concluded event's
 *  outcome stayed visible; that view is now `mine=1` here with no status
 *  narrowed (see `limited-your-events.route.tsx`'s redirect).
 *
 *  Data union: the viewer can only ever see an OPEN event they haven't
 *  joined (anyone can, via `listOpenLimitedEvents`) or one they occupy a Seat
 *  in at any phase (`myLimitedEvents`) — there is no "browse every event
 *  regardless of phase and ownership" query, by design (a Sealed/Draft Pool
 *  is private). The merged list is exactly that union, deduplicated by id. */
export default function LimitedEventsPage({
    mine,
    status,
    onMineChange,
    onStatusChange,
}: {
    mine: boolean;
    status: LimitedEventStatusChip | undefined;
    onMineChange: (next: boolean) => void;
    onStatusChange: (next: LimitedEventStatusChip | undefined) => void;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const openEvents = useOpenLimitedEvents();
    const myEvents = useMyLimitedEvents();
    const draftableSets = useDraftableSets();
    const { create, join } = useLimitedEventMutations();

    const [createOpen, setCreateOpen] = useState(false);
    const [createPending, setCreatePending] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [joinPendingEventId, setJoinPendingEventId] =
        useState<Id<"limitedEvents"> | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);

    const viewerId = user?._id ?? "";

    // Union by id — `myEvents` wins on overlap (it carries the viewer's own
    // match record; `openEvents` never does, since an open event has no play
    // phase yet anyway, but this keeps the merge rule obvious either way).
    // The two source queries are differently ordered (`openEvents` is
    // `by_status` index order — ascending creation; `myEvents` is
    // `.order("desc")`), so Map insertion order is not a display order —
    // sort explicitly, newest first, matching what the page this merged list
    // replaces documented (`limited-your-events-page.tsx` on main before
    // issue #2590).
    const merged = useMemo((): LimitedEventSummaryView[] => {
        if (openEvents === undefined || myEvents === undefined) return [];
        const byId = new Map<string, LimitedEventSummaryView>();
        for (const event of openEvents) byId.set(event._id, event);
        for (const event of myEvents) byId.set(event._id, event);
        return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    }, [openEvents, myEvents]);

    const filtered = useMemo(() => {
        return merged.filter((event) => {
            if (mine && !event.seats.some((s) => s.userId === viewerId)) {
                return false;
            }
            if (status && limitedEventStatusChip(event) !== status) {
                return false;
            }
            return true;
        });
    }, [merged, mine, status, viewerId]);

    if (
        openEvents === undefined ||
        myEvents === undefined ||
        draftableSets === undefined ||
        user === undefined
    ) {
        return <LoadingScreen />;
    }

    const handleOpen = (eventId: Id<"limitedEvents">) => {
        void navigate({
            to: "/limited/$eventId",
            params: { eventId },
        });
    };

    const handleJoin = async (eventId: Id<"limitedEvents">) => {
        if (joinPendingEventId) return;
        setJoinPendingEventId(eventId);
        setJoinError(null);
        try {
            await join({ eventId });
            handleOpen(eventId);
        } catch (err) {
            setJoinError(
                err instanceof Error ? err.message : "Failed to join event."
            );
        } finally {
            setJoinPendingEventId(null);
        }
    };

    const handleCreate = async (payload: CreateLimitedEventPayload) => {
        if (createPending) return;
        setCreatePending(true);
        setCreateError(null);
        try {
            const eventId = await create(payload);
            setCreateOpen(false);
            handleOpen(eventId);
        } catch (err) {
            setCreateError(
                err instanceof Error ? err.message : "Failed to create event."
            );
        } finally {
            setCreatePending(false);
        }
    };

    const emptyMessage =
        mine || status
            ? "No Limited Events match this filter."
            : "No open Limited Events right now.";

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            <Panel>
                <PanelHeader title="Limited Events" />
                <PanelBody>
                    {joinError && <Banner tone="danger">{joinError}</Banner>}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <LimitedStatusFilterBar
                            value={status}
                            onChange={onStatusChange}
                        />
                        <Button
                            type="button"
                            variant={mine ? "secondary" : "ghost"}
                            size="xs"
                            aria-pressed={mine}
                            onClick={() => onMineChange(!mine)}
                        >
                            Mine
                        </Button>
                    </div>

                    <LimitedEventList
                        events={filtered}
                        viewerId={viewerId}
                        onJoin={(eventId) => void handleJoin(eventId)}
                        onOpen={handleOpen}
                        joinPendingEventId={joinPendingEventId}
                        emptyMessage={emptyMessage}
                    />

                    {canCreateLimitedEvents(user) && (
                        <div className="flex justify-center">
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setCreateOpen(true)}
                            >
                                + Create Event
                            </Button>
                        </div>
                    )}
                </PanelBody>
            </Panel>

            <CreateLimitedEventDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                draftableSets={draftableSets}
                onCreate={(payload) => void handleCreate(payload)}
                pending={createPending}
                error={createError}
            />
        </div>
    );
}
