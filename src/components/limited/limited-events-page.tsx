import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useDraftableSets,
    useLimitedEventMutations,
    useMyLimitedEvents,
    useOpenLimitedEvents,
} from "~/hooks/useLimitedEvent";
import { canCreateLimitedEvents } from "~/lib/limitedGating";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import LimitedEventList from "./limited-event-list";
import LimitedMyEventsList from "./limited-my-events-list";
import CreateLimitedEventDialog, {
    type CreateLimitedEventPayload,
} from "./create-limited-event-dialog";

/** Limited Events lobby (PRD #1107, ADR 0054/0055, issue #1110): lists open
 *  events, lets any user join a free Seat, and lets any signed-in user open
 *  the Create Event dialog to host their own table. */
export default function LimitedEventsPage() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const events = useOpenLimitedEvents();
    const myEvents = useMyLimitedEvents();
    const draftableSets = useDraftableSets();
    const { create, join } = useLimitedEventMutations();

    const [createOpen, setCreateOpen] = useState(false);
    const [createPending, setCreatePending] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [joinPendingEventId, setJoinPendingEventId] =
        useState<Id<"limitedEvents"> | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);

    if (
        events === undefined ||
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

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            <Panel>
                <PanelHeader title="Limited Events" />
                <PanelBody>
                    {joinError && <Banner tone="danger">{joinError}</Banner>}

                    {canCreateLimitedEvents(user) && (
                        <div className="flex justify-end">
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setCreateOpen(true)}
                            >
                                + Create Event
                            </Button>
                        </div>
                    )}

                    <LimitedMyEventsList
                        events={myEvents}
                        onOpen={handleOpen}
                    />

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
