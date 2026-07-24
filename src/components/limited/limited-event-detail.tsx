import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useLimitedEvent,
    useLimitedEventMutations,
} from "~/hooks/useLimitedEvent";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import ActionButton from "~/components/board/action-button";
import LimitedEventSeatList from "./limited-event-seat-list";
import LimitedEventSeatsDisclosure from "./limited-event-seats-disclosure";
import LimitedDraftTable from "./limited-draft-table";
import LimitedSeatPoolPanel from "./limited-seat-pool-panel";
import LimitedVsAiPanel from "./limited-vs-ai-panel";
import LimitedReviewPanel from "./limited-review-panel";
import LimitedShareInviteButton from "./limited-share-invite-button";

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
    // Mirrors `isEventPoolFinal` (`convex/limited/autoBuild.ts`, issue
    // #1115): the point at which every bot seat's Pool — and therefore its
    // Auto-Built deck — is final and the vs-AI hookup can offer it.
    const isPoolFinal =
        event.status === "started" &&
        (event.type === "sealed" || event.draftCompletedAt !== undefined);
    // During an active draft the per-seat roster is noise (the drafter watches
    // the Booster, not the table), so it collapses behind a "Seats" summary.
    const draftInProgress =
        event.status === "started" &&
        event.type === "draft" &&
        !event.draftCompletedAt;

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
                <Button
                    variant="link"
                    size="sm"
                    onClick={handleBack}
                    className="self-start"
                >
                    ← Back to Limited Events
                </Button>

                {error && <Banner tone="danger">{error}</Banner>}

                {draftInProgress ? (
                    <LimitedEventSeatsDisclosure event={event} />
                ) : (
                    <>
                        <LimitedEventSeatList event={event} />

                        {/* Event completion status (PRD #1107 story 26, issue
                            #1116): "completed" is reached exactly when every
                            seat has a deck (humans submitted, bots auto-built)
                            — visible here, and it's the same flag that gates
                            `LimitedReviewPanel` below. Gated on `isPoolFinal`
                            rather than merely `status === "started"` (issue
                            #1580): a deck cannot exist before the Pool is
                            final, so the "N/seatCount decks in" counter would
                            otherwise misread as live progress while a Draft
                            is still running — this branch happens to only
                            render when `!draftInProgress` today, but the
                            explicit `isPoolFinal` gate keeps the invariant
                            true even if that branching ever changes. */}
                        {isPoolFinal && (
                            <p className="text-xs text-text-muted">
                                {event.completed
                                    ? "Event completed — every seat has a deck."
                                    : `${event.seatsWithDeck}/${event.seatCount} decks in.`}
                            </p>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-2">
                    {/* Available for the whole lifetime of the event (issue
                        #1578) — previously gated to `status === "open"`,
                        which meant a started event's direct link could no
                        longer be recovered in-app once the "your events"
                        list's own View button had already been used to get
                        here (or by anyone who lost the original invite). */}
                    <LimitedShareInviteButton eventId={eventId} />
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

                {event.status === "started" &&
                    event.type === "sealed" &&
                    viewerSeat?.pool && (
                        <LimitedSeatPoolPanel
                            eventId={eventId}
                            pool={viewerSeat.pool}
                        />
                    )}

                {event.status === "started" &&
                    event.type === "draft" &&
                    !event.draftCompletedAt &&
                    viewerSeat && (
                        <LimitedDraftTable
                            eventId={eventId}
                            seat={viewerSeat}
                            round={event.draftRound ?? 0}
                            totalRounds={event.packSlots.length}
                        />
                    )}

                {event.status === "started" &&
                    event.type === "draft" &&
                    event.draftCompletedAt &&
                    viewerSeat?.pool && (
                        <LimitedSeatPoolPanel
                            eventId={eventId}
                            pool={viewerSeat.pool}
                        />
                    )}

                {isPoolFinal && viewerSeat && (
                    <LimitedVsAiPanel
                        eventId={eventId}
                        event={event}
                        viewerSeatIndex={viewerSeat.seatIndex}
                    />
                )}

                <LimitedReviewPanel event={event} />
            </PanelBody>
        </Panel>
    );
}
