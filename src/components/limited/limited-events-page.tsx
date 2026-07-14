import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useDraftableSets,
    useLimitedEventMutations,
    useOpenLimitedEvents,
} from "~/hooks/useLimitedEvent";
import { canCreateLimitedEvents } from "~/lib/adminGating";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import LoadingScreen from "~/components/ui/loading-screen";
import LimitedEventList from "./limited-event-list";
import CreateLimitedEventDialog, {
    type CreateLimitedEventPayload,
} from "./create-limited-event-dialog";

/** Limited Events lobby (PRD #1107, ADR 0054/0055, issue #1110): lists open
 *  events, lets any user join a free Seat, and — for an admin — opens the
 *  Create Event dialog. */
export default function LimitedEventsPage() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const events = useOpenLimitedEvents();
    const draftableSets = useDraftableSets();
    const { create, join } = useLimitedEventMutations();

    const [createOpen, setCreateOpen] = useState(false);
    const [createPending, setCreatePending] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [joinPendingEventId, setJoinPendingEventId] =
        useState<Id<"limitedEvents"> | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);

    if (events === undefined || draftableSets === undefined || user === undefined) {
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

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            <Panel>
                <PanelHeader title="Limited Events" />
                <PanelBody>
                    {joinError && (
                        <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                            {joinError}
                        </div>
                    )}

                    {canCreateLimitedEvents(user) && (
                        <div className="flex justify-end">
                            <button
                                onClick={() => setCreateOpen(true)}
                                className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                            >
                                + Create Event
                            </button>
                        </div>
                    )}

                    <LimitedEventList
                        events={events}
                        viewerId={user?._id ?? ""}
                        onJoin={(eventId) => void handleJoin(eventId)}
                        onOpen={handleOpen}
                        joinPendingEventId={joinPendingEventId}
                    />
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
