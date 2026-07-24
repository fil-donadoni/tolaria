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
import GameDialog from "~/components/ui/game-dialog";
import LoadingScreen from "~/components/ui/loading-screen";
import ActionButton from "~/components/board/action-button";
import LimitedEventSeatList from "./limited-event-seat-list";
import LimitedEventSeatsDisclosure from "./limited-event-seats-disclosure";
import LimitedDraftTable from "./limited-draft-table";
import LimitedSeatPoolPanel from "./limited-seat-pool-panel";
import LimitedVsAiPanel from "./limited-vs-ai-panel";
import LimitedChallengePanel from "./limited-challenge-panel";
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
    const { join, leave, cancel, start } = useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Confirmation affordances (issue #1579) — a misclick on either is not
    // recoverable (leave drops your Seat and any progress toward it; cancel
    // deletes the whole event), so both gate behind an explicit dialog
    // rather than firing straight off the button (mirrors the lobby's
    // delete-preset `GameDialog` confirmation).
    const [confirmLeave, setConfirmLeave] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);

    if (event === undefined || user === undefined) {
        return <LoadingScreen />;
    }

    const handleBack = () => void navigate({ to: "/limited" });

    // The creator cancelling out from under a live viewer (issue #1579) —
    // `getLimitedEvent` returns `null` rather than throwing precisely so this
    // page can offer a graceful way back instead of crashing (no app-wide
    // ErrorBoundary exists to catch a thrown error).
    if (event === null) {
        return (
            <Panel size="wide">
                <PanelHeader title="Limited Event" />
                <PanelBody>
                    <Banner tone="info">
                        This event no longer exists — it may have been
                        cancelled.
                    </Banner>
                    <Button
                        variant="link"
                        size="sm"
                        onClick={handleBack}
                        className="self-start"
                    >
                        ← Back to Limited Events
                    </Button>
                </PanelBody>
            </Panel>
        );
    }

    const viewerSeat = user
        ? event.seats.find((s) => s.userId === user._id)
        : undefined;
    const isCreator = user !== null && event.createdBy === user._id;
    const canJoin = event.status === "open" && !viewerSeat;
    const canStart = event.status === "open" && isCreator;
    // An occupant can leave their own Seat; the creator can cancel the whole
    // event — both OPEN-only (issue #1579's out-of-scope note: dropping from
    // a started event is a different, undesigned, concession/replacement
    // policy). Independent of each other: the creator, if ALSO seated, sees
    // both actions.
    const canLeave = event.status === "open" && !!viewerSeat;
    const canCancel = event.status === "open" && isCreator;
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
    // The confirm dialogs close themselves before firing — `runMutation`'s own
    // pending/error state (already the disable-while-in-flight source of
    // truth for every other action button here) drives the rest.
    const handleLeave = () => {
        setConfirmLeave(false);
        void runMutation(() => leave({ eventId }));
    };
    const handleCancel = () => {
        setConfirmCancel(false);
        // Cancel deletes the row — `getLimitedEvent` reactively flips to
        // `null` and the `event === null` branch above takes over, so no
        // explicit navigate is needed here (and racing one against the
        // reactive update would be strictly worse).
        void runMutation(() => cancel({ eventId }));
    };

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
                    {canLeave && (
                        <ActionButton
                            onClick={() => setConfirmLeave(true)}
                            label="Leave Seat"
                            tone="secondary"
                            disabled={pending}
                        />
                    )}
                    {canCancel && (
                        <ActionButton
                            onClick={() => setConfirmCancel(true)}
                            label="Cancel Event"
                            tone="destructive"
                            disabled={pending}
                        />
                    )}
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
                    <>
                        <LimitedChallengePanel
                            eventId={eventId}
                            event={event}
                            viewerSeatIndex={viewerSeat.seatIndex}
                        />
                        <LimitedVsAiPanel
                            eventId={eventId}
                            event={event}
                            viewerSeatIndex={viewerSeat.seatIndex}
                        />
                    </>
                )}

                <LimitedReviewPanel event={event} />
            </PanelBody>

            <GameDialog
                open={confirmLeave}
                onOpenChange={setConfirmLeave}
                title="Leave this Seat?"
                subtitle="It returns to open — anyone else can take it."
            >
                <div className="mt-4 flex justify-end gap-2">
                    <ActionButton
                        onClick={() => setConfirmLeave(false)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={handleLeave}
                        label="Leave Seat"
                        tone="destructive"
                        disabled={pending}
                    />
                </div>
            </GameDialog>

            <GameDialog
                open={confirmCancel}
                onOpenChange={setConfirmCancel}
                title="Cancel this event?"
                subtitle="This removes it for every seated player. This action cannot be undone."
            >
                <div className="mt-4 flex justify-end gap-2">
                    <ActionButton
                        onClick={() => setConfirmCancel(false)}
                        label="Keep Event"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={handleCancel}
                        label="Cancel Event"
                        tone="destructive"
                        disabled={pending}
                    />
                </div>
            </GameDialog>
        </Panel>
    );
}
