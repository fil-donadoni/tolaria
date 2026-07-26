import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canViewLimitedReviewDetail } from "~/lib/adminGating";
import {
    useLimitedEvent,
    useLimitedEventMutations,
} from "~/hooks/useLimitedEvent";
import { PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import LoadingScreen from "~/components/ui/loading-screen";
import ActionButton from "~/components/board/action-button";
import LimitedTablePanel from "./limited-table-panel";
import LimitedEventSeatsDisclosure from "./limited-event-seats-disclosure";
import LimitedDraftTable from "./limited-draft-table";
import LimitedYourDeckPanel from "./limited-your-deck-panel";
import LimitedVsAiPanel from "./limited-vs-ai-panel";
import LimitedChallengePanel from "./limited-challenge-panel";
import LimitedReviewPanel from "./limited-review-panel";
import LimitedShareInviteButton from "./limited-share-invite-button";
import LimitedEventPageFrame from "./limited-event-page-frame";
import LimitedEventToolbar from "./limited-event-toolbar";
import { limitedEventName } from "~/lib/limitedEventName";
import { useAutoOpenLimitedBuilder } from "~/hooks/useAutoOpenLimitedBuilder";

/** One Limited Event's detail page (PRD #1107, ADR 0054/0055). It shows what
 *  the event's phase makes actionable, and nothing else:
 *  - OPEN — the table, plus Join / Start / Leave / Cancel.
 *  - DRAFTING — the Booster, with the table collapsed behind a summary.
 *  - POOL FINAL, no deck yet — deck building (the player is sent straight to
 *    the builder; this page keeps the way back into it).
 *  - DECK IN — the table's build progress and the match lobby (challenges,
 *    vs-AI), which is what a finished builder actually wants next. */
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

    // Computed before the loading/deleted early returns because the auto-open
    // effect below must run on every render (hooks can't sit behind a return).
    const viewerSeat =
        user && event
            ? event.seats.find((s) => s.userId === user._id)
            : undefined;
    // End of the Draft (or start of a Sealed event) IS the start of deck
    // building — go there instead of parking on a read-only Pool.
    useAutoOpenLimitedBuilder(eventId, event, viewerSeat);

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
            <LimitedEventPageFrame>
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
            </LimitedEventPageFrame>
        );
    }

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
        <LimitedEventPageFrame>
            {/* The format IS the title (issue: the old header spent three rows
                on "LIMITED EVENT" + a flourish subtitle reading
                "draft — VINTAGE-CUBE, VINTAGE-CUBE, VINTAGE-CUBE — started").
                `limitedEventName` collapses the repeated pack sources to
                "Vintage Cube Draft"; the phase moves into the toolbar chip. */}
            <PanelHeader title={limitedEventName(event)} />
            <PanelBody>
                <LimitedEventToolbar event={event} onBack={handleBack} />

                {error && <Banner tone="danger">{error}</Banner>}

                {/* The build-progress bar is gated on `isPoolFinal` (issue
                    #1580): a deck cannot exist before the Pool is final, so
                    the "N/seatCount decks in" counter would otherwise misread
                    as live progress while a Draft is still running. */}
                {draftInProgress ? (
                    <LimitedEventSeatsDisclosure event={event} />
                ) : (
                    <LimitedTablePanel
                        event={event}
                        showProgress={isPoolFinal}
                    />
                )}

                <div className="flex justify-end gap-2">
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

                {/* Explains the Start button next to it — so it belongs to
                    whoever can actually press it, and only while pressing it
                    is possible. It used to render unconditionally, which left
                    a started event telling every viewer they could still
                    start it. */}
                {canStart && (
                    <div className="text-right text-sm italic">
                        You can start the event at any time. The free seats will
                        be managed by bots, both for draft and for gameplay
                    </div>
                )}

                {draftInProgress && viewerSeat && (
                    <LimitedDraftTable
                        eventId={eventId}
                        seat={viewerSeat}
                        round={event.draftRound ?? 0}
                        totalRounds={event.packSlots.length}
                    />
                )}

                {/* The viewer's deck + the builder entry point, in EVERY
                    post-Pool state (never gated on `hasDeck`: that flag is
                    existence-only, so gating hid the builder from a player who
                    left it below the 40-card minimum and stranded them). The
                    Pool itself is no longer mirrored here read-only — the
                    builder shows the same cards and lets the player act on
                    them, and `useAutoOpenLimitedBuilder` has usually taken
                    them straight there already. */}
                {isPoolFinal && viewerSeat && (
                    <LimitedYourDeckPanel
                        eventId={eventId}
                        seatIndex={viewerSeat.seatIndex}
                        poolCount={viewerSeat.poolCount}
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

                <LimitedReviewPanel
                    event={event}
                    isAdmin={canViewLimitedReviewDetail(user)}
                />

                {/* Page-footer utilities. The link stays available for the
                    whole lifetime of the event (issue #1578) — gating it to
                    `status === "open"` meant a started event's direct link
                    could no longer be recovered in-app — but it is not an
                    event ACTION, so it sits down here rather than in the
                    Join/Start/Leave row. `canInvite` keeps the label honest:
                    only an open event can actually take a new player. */}
                <div className="mt-2 flex justify-end border-t border-border-accent/20 pt-3">
                    <LimitedShareInviteButton
                        eventId={eventId}
                        canInvite={event.status === "open"}
                    />
                </div>
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
        </LimitedEventPageFrame>
    );
}
