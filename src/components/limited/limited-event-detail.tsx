import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useLimitedEvent, useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import LoadingScreen from "~/components/ui/loading-screen";
import ActionButton from "~/components/board/action-button";
import LimitedEventSeatList from "./limited-event-seat-list";
import LimitedPoolView from "./limited-pool-view";

/** One Limited Event's detail page (PRD #1107, ADR 0054/0055): the Seat list,
 *  a Join button (open events, no seat yet), a Start button (the event's
 *  creator, while open), and — once started — the viewer's own Pool. */
export default function LimitedEventDetail({
    eventId,
}: {
    eventId: Id<"limitedEvents">;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const event = useLimitedEvent(eventId);
    const { join, start } = useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (event === undefined || user === undefined) {
        return <LoadingScreen />;
    }

    const viewerSeat = user
        ? event.seats.find((s) => s.userId === user._id)
        : undefined;
    const isCreator = user !== null && event.createdBy === user._id;
    const canJoin = event.status === "open" && !viewerSeat;
    const canStart = event.status === "open" && isCreator;

    const runMutation = async (run: () => Promise<unknown>) => {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await run();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    const handleJoin = () => runMutation(() => join({ eventId }));
    const handleStart = () => runMutation(() => start({ eventId }));
    const handleBack = () => void navigate({ to: "/limited" });

    return (
        <Panel size="wide">
            <PanelHeader
                title="Limited Event"
                subtitle={`${event.type} — ${event.packSlots.join(", ").toUpperCase()} — ${event.status}`}
            />
            <PanelBody>
                <button
                    onClick={handleBack}
                    className="self-start text-xs text-text-muted hover:underline"
                >
                    ← Back to Limited Events
                </button>

                {error && (
                    <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                        {error}
                    </div>
                )}

                <LimitedEventSeatList event={event} />

                <div className="flex justify-end gap-2">
                    {canJoin && (
                        <ActionButton
                            onClick={handleJoin}
                            label="Join Event"
                            tone="primary"
                            disabled={pending}
                        />
                    )}
                    {canStart && (
                        <ActionButton
                            onClick={handleStart}
                            label="Start Event"
                            tone="primary"
                            disabled={pending}
                        />
                    )}
                </div>

                {event.status === "started" && viewerSeat?.pool && (
                    <div className="mt-4 border-t border-border-accent/20 pt-4">
                        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
                            Your Pool
                        </h3>
                        <LimitedPoolView pool={viewerSeat.pool} />
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}
