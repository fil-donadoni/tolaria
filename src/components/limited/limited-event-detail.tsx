import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import {
    useLimitedEvent,
    useLimitedEventMutations,
    usePackSources,
} from "~/hooks/useLimitedEvent";
import { PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import LoadingScreen from "~/components/ui/loading-screen";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import ErrorState from "~/components/ui/error-state";
import ActionButton from "~/components/board/action-button";
import LimitedTablePanel from "./limited-table-panel";
import LimitedYourDeckPanel from "./limited-your-deck-panel";
import LimitedDeckPreview from "./limited-deck-preview";
import LimitedVsAiPanel from "./limited-vs-ai-panel";
import LimitedChallengePanel from "./limited-challenge-panel";
import LimitedReviewPanel from "./limited-review-panel";
import LimitedReviewTabs, {
    EVENT_PANEL_ID,
    type EventPageTab,
} from "./limited-review-tabs";
import LimitedStandingsTable from "./limited-standings-table";
import LimitedEventWinnerBanner from "./limited-event-winner-banner";
import LimitedRoundPanel from "./limited-round-panel";
import LimitedEventHeader from "./limited-event-header";
import LimitedEventStepper from "./limited-event-stepper";
import LimitedEventMenu from "./limited-event-menu";
import LimitedEventHeroCard from "./limited-event-hero";
import LimitedStartUnseatedDialog from "./limited-start-unseated-dialog";
import LimitedEventDraftProgress from "./limited-event-draft-progress";
import LimitedEventPageFrame from "./limited-event-page-frame";
import LimitedEventToolbar from "./limited-event-toolbar";
import { packSourceForEvent } from "~/lib/limited/limitedHub";
import { limitedEventHero } from "~/lib/limited/limitedEventHero";
import { OPEN_DECKLISTS_JOIN_WARNING } from "~/lib/openDecklists";
import {
    arePoolsDealt,
    areDraftPicksLegal,
    areRoundsRunning,
    isEventConcluded,
    isSeatingOpen,
} from "@convex/limited/eventStatus";
import { useAutoOpenLimitedBuilder } from "~/hooks/useAutoOpenLimitedBuilder";
import { useDraftRoomRedirect } from "~/hooks/useDraftRoomRedirect";
import { useRoundCascadeRecovery } from "~/hooks/useRoundCascadeRecovery";

/** One Limited Event's detail page (PRD #1107, ADR 0054/0055; skeleton by
 *  PRD #5383 / issue #5389). One skeleton for every phase: Feature Card
 *  header, phase stepper, a hero with the phase's ONE primary CTA
 *  (`limitedEventHero`), secondary actions in the ⋯ menu, then phase tiles.
 *  It shows what the event's phase makes actionable, and nothing else:
 *  - OPEN — the table, plus Join / Start (hero); Leave Event (hero) / Cancel (⋯).
 *  - DRAFTING — the way into the Draft Room (issue #2587): the Booster is
 *    NOT here any more, it is `/limited/$eventId/draft`, and a seated player
 *    landing here mid-draft is sent straight there once per tab
 *    (`useDraftRoomRedirect`).
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
    const packSources = usePackSources();
    const { join, leave, cancel, start } = useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pageTab, setPageTab] = useState<EventPageTab>("event");
    // Confirmation affordances (issue #1579) — a misclick on either is not
    // recoverable (leave drops your Seat and any progress toward it; cancel
    // deletes the whole event), so both gate behind an explicit dialog
    // rather than firing straight off the button (mirrors the lobby's
    // delete-preset `GameDialog` confirmation).
    const [confirmLeave, setConfirmLeave] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);
    // Starting without a Seat must be deliberate (issue #5665).
    const [confirmStartUnseated, setConfirmStartUnseated] = useState(false);
    // Computed before the loading/deleted early returns because the auto-open
    // effect below must run on every render (hooks can't sit behind a return).
    const viewerSeat =
        user && event
            ? event.seats.find((s) => s.userId === user._id)
            : undefined;
    // End of the Draft (or start of a Sealed event) IS the start of deck
    // building — go there instead of parking on a read-only Pool.
    useAutoOpenLimitedBuilder(eventId, event, viewerSeat);
    // ...and the same one-shot, one phase earlier: while a Pick is pending the
    // Draft Room is where the player belongs (issue #2587).
    useDraftRoomRedirect(eventId, event, viewerSeat);
    // Recovery, not a normal path: an event whose latest round is decided but
    // which never advanced has no server-side entry point left that can move
    // it (see `nudgeEventRounds`) — a seat viewing it is the retry.
    useRoundCascadeRecovery({
        eventId,
        event,
        enabled: viewerSeat !== undefined,
    });

    if (event === undefined || user === undefined) {
        return <LoadingScreen />;
    }

    const handleBack = () => void navigate({ to: "/limited" });

    // The creator cancelling out from under a live viewer (issue #1579) —
    // `getLimitedEvent` returns `null` rather than throwing precisely so this
    // page can offer a graceful way back instead of crashing (no app-wide
    // ErrorBoundary exists to catch a thrown error). An ERROR state (the
    // event this route names is gone), not the info-tone note it used to be
    // — same "subject is gone" shape `pool-deck-builder.tsx` hits (issue
    // #2592).
    if (event === null) {
        return (
            <LimitedEventPageFrame>
                <SurfaceReadyMarker />
                <PanelHeader title="Limited Event" />
                <PanelBody>
                    <ErrorState
                        message="This event no longer exists — it may have been cancelled."
                        action={
                            <Button
                                variant="link"
                                size="sm"
                                onClick={handleBack}
                                className="self-start"
                            >
                                ← Back to Limited Events
                            </Button>
                        }
                    />
                </PanelBody>
            </LimitedEventPageFrame>
        );
    }

    // Every phase question routes through `convex/limited/eventStatus.ts`
    // rather than comparing `event.status` literally (ADR 0076): with four
    // lifecycle members a raw `=== "started"` is a bug waiting for the play
    // phase to ship.
    const seatingOpen = isSeatingOpen(event.status);
    const isCreator = user !== null && event.createdBy === user._id;
    const canJoin = seatingOpen && !viewerSeat;
    const canStart = seatingOpen && isCreator;
    // An occupant can leave their own Seat, OPEN-only (issue #1579's
    // out-of-scope note: dropping from a started event is a different,
    // undesigned, concession/replacement policy). Independent of `canClose`:
    // the creator, if ALSO seated, sees both actions.
    const canLeave =
        !!viewerSeat &&
        !viewerSeat.isDropped &&
        !isEventConcluded(event.status);
    // The creator's ONE close action, for the whole life of the event up to
    // (but not including) its conclusion (issue #2357, tightened by #2674) —
    // no longer OPEN-only. What it DOES branches by phase (hard delete while
    // seating is open, force-finish once started). Once the event is
    // CONCLUDED there is nothing left to close, so the affordance itself
    // hides — offering an action whose only possible outcome is a no-op is
    // the bug (#2674), not a harmless quirk. The mutation still absorbs a
    // stray second call idempotently (`convex/limitedEvents.ts`
    // `cancelLimitedEvent`) — that is server-side defense for a race between
    // two clicks, not a licence for the client to offer the action here.
    const canClose = isCreator && !isEventConcluded(event.status);
    // Mirrors `isEventPoolFinal` (`convex/limited/autoBuild.ts`, issue
    // #1115): the point at which every bot seat's Pool — and therefore its
    // Auto-Built deck — is final and the vs-AI hookup can offer it. Stays true
    // through the play phase and past the event's end — a Pool is never
    // un-dealt.
    const isPoolFinal =
        arePoolsDealt(event.status) &&
        (event.type === "sealed" || event.draftCompletedAt !== undefined);
    const draftInProgress =
        areDraftPicksLegal(event.status) &&
        event.type === "draft" &&
        !event.draftCompletedAt;
    // Issue #2515's `collapseChrome` is GONE, superseded by issue #2587
    // rather than kept alongside it. It folded this page's title, badges,
    // Seats and Close Event away on a compact viewport so the Booster could
    // fit under them; the Booster is not under them any more, it is on its
    // own immersive route, so there is nothing left for the fold to buy and
    // the page renders its chrome identically at every viewport again.
    // Standings become the event's live scoreboard once the play phase's
    // Swiss rounds are actually running, and stay visible once the event has
    // concluded (PRD #1628 stories 22-24/39-40, issue #1643) — never during
    // `open`/`started`, where no round has been decided and the table would
    // just be permanent noise ahead of the feature it's reporting on.
    const showStandings =
        areRoundsRunning(event.status) || isEventConcluded(event.status);
    // The round panel (PRD #1628 stories 6-7, issue #1644) — the current round
    // and the viewer's own pairing. Only while the rounds are actually
    // RUNNING: once the event is concluded there is no "current" pairing to
    // act on, and the final standings above are the whole story.
    const showRoundPanel = areRoundsRunning(event.status);
    // "Review the table" is a second tab from the Play Phase on (issue
    // #5392); before it there is nothing to review and no tab bar at all.
    const showReviewTab = showStandings;
    const reviewing = showReviewTab && pageTab === "review";

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
    const handleStartRequest = () => {
        if (viewerSeat) void handleStart();
        else setConfirmStartUnseated(true);
    };
    const handleConfirmStartUnseated = () => {
        setConfirmStartUnseated(false);
        void handleStart();
    };
    // The confirm dialogs close themselves before firing — `runMutation`'s own
    // pending/error state (already the disable-while-in-flight source of
    // truth for every other action button here) drives the rest.
    const handleLeave = () => {
        setConfirmLeave(false);
        void runMutation(() => leave({ eventId }));
    };
    const handleCancel = () => {
        setConfirmCancel(false);
        // While seating is open this still deletes the row —
        // `getLimitedEvent` reactively flips to `null` and the
        // `event === null` branch above takes over, so no explicit navigate
        // is needed here (and racing one against the reactive update would
        // be strictly worse). Once the event has started, the SAME mutation
        // force-finishes it in place instead (issue #2357): the row survives
        // and this page's own `isEventConcluded` branches re-render it as
        // concluded, no navigation needed there either.
        void runMutation(() => cancel({ eventId }));
    };

    const hero = limitedEventHero(event, {
        isCreator,
        seat: viewerSeat,
    });
    const source = packSourceForEvent(event, packSources ?? []);

    const tableBlock = (
        <div data-slot="event-table">
            <LimitedTablePanel event={event} showProgress={isPoolFinal} />
        </div>
    );

    return (
        <LimitedEventPageFrame>
            <SurfaceReadyMarker />
            <PanelBody>
                <LimitedEventToolbar onBack={handleBack} />

                <LimitedEventHeader
                    event={event}
                    source={source}
                    menu={
                        <LimitedEventMenu
                            eventId={eventId}
                            canInvite={seatingOpen}
                            onCancel={
                                canClose
                                    ? () => setConfirmCancel(true)
                                    : undefined
                            }
                            cancelLabel={
                                seatingOpen ? "Cancel Event" : "Close Event"
                            }
                            disabled={pending}
                        />
                    }
                />

                <LimitedEventStepper phase={hero.phase} />

                {showReviewTab && (
                    <LimitedReviewTabs tab={pageTab} onChange={setPageTab} />
                )}

                {error && <Banner tone="danger">{error}</Banner>}

                {/* Warned before sitting down, never after (issue #5386):
                    joining an Open Decklists event accepts the disclosure. */}
                {canJoin && event.openDecklists && (
                    <Banner tone="info" data-slot="open-decklists-join-warning">
                        {OPEN_DECKLISTS_JOIN_WARNING}
                    </Banner>
                )}

                {!reviewing && (
                    <LimitedEventHeroCard
                        eventId={eventId}
                        event={event}
                        hero={hero}
                        pending={pending}
                        onJoin={handleJoin}
                        onStart={handleStartRequest}
                        onLeave={
                            canLeave ? () => setConfirmLeave(true) : undefined
                        }
                        hint={
                            canStart && !viewerSeat
                                ? "Join a seat first, then start — or start without playing. The free seats will be managed by bots, both for draft and for gameplay"
                                : canStart
                                  ? "You can start the event at any time. The free seats will be managed by bots, both for draft and for gameplay"
                                  : undefined
                        }
                    />
                )}
            </PanelBody>

            <div
                role={showReviewTab ? "tabpanel" : undefined}
                id={showReviewTab ? EVENT_PANEL_ID : undefined}
                aria-labelledby={
                    showReviewTab ? `event-tab-${pageTab}` : undefined
                }
            >
                {reviewing ? (
                    <PanelBody className="mt-3">
                        <LimitedReviewPanel event={event} />
                    </PanelBody>
                ) : (
                    <PanelBody className="mt-3">
                        {/* Games phase (issue #6919): Standings beside the viewer's
                    deck first, the round panel next, the table LAST — every
                    seat is filled and every deck is in, so the table carries
                    nothing actionable now. */}
                        {showRoundPanel && (
                            <div
                                data-slot="games-lead"
                                className="grid grid-cols-1 items-start gap-3 md:grid-cols-2"
                            >
                                <div
                                    className={
                                        viewerSeat && isPoolFinal
                                            ? undefined
                                            : "md:col-span-2"
                                    }
                                >
                                    <LimitedStandingsTable event={event} />
                                </div>
                                {viewerSeat && isPoolFinal && (
                                    <LimitedDeckPreview
                                        eventId={eventId}
                                        seatIndex={viewerSeat.seatIndex}
                                    />
                                )}
                            </div>
                        )}

                        {!showRoundPanel && tableBlock}

                        {draftInProgress && (
                            <LimitedEventDraftProgress
                                event={event}
                                pickCount={
                                    viewerSeat
                                        ? (viewerSeat.poolCount ?? 0)
                                        : null
                                }
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
                        {isPoolFinal && viewerSeat && !showRoundPanel && (
                            <LimitedYourDeckPanel
                                eventId={eventId}
                                seatIndex={viewerSeat.seatIndex}
                                poolCount={viewerSeat.poolCount}
                            />
                        )}

                        {/* Free challenges and Play-vs-Bots are REPLACED while the
                    event's rounds are running (ADR 0076 consequences, PRD
                    #1628: "no free challenges while the event is live") — the
                    round panel below carries the one Match the viewer is
                    supposed to play, and a free Match would burn the
                    single-active-Match slot their pairing needs. They come
                    back once the event has concluded, as unrecorded
                    playtesting (issue #1648) — the banner below is what
                    actually tells the player that, so a post-event friendly
                    game is never mistaken for a standings result. The server
                    backs this up independently: `challengeLimitedSeat` and
                    `createSoloGame`'s event binding both reject while
                    `areRoundsRunning(event.status)` (`convex/game.ts`). */}
                        {isPoolFinal && viewerSeat && !showRoundPanel && (
                            <>
                                {isEventConcluded(event.status) && (
                                    <Banner tone="info" className="mb-2">
                                        Event finished — matches below are
                                        unrecorded playtesting and do not count
                                        toward standings.
                                    </Banner>
                                )}
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

                        {/* The round's Match action is hosted by the hero (it is the
                    phase's one CTA), so the panel keeps the pairing line and
                    the other tables only. */}
                        {showRoundPanel && (
                            <LimitedRoundPanel
                                eventId={eventId}
                                event={event}
                                hideAction={hero.cta.kind === "play"}
                            />
                        )}

                        {/* The event's conclusion (PRD #1628 story 40, issue #1646) —
                    sits ABOVE the standings it's read off, so a concluded
                    event states its outcome before the table backing it. */}
                        <LimitedEventWinnerBanner event={event} />

                        {showStandings && !showRoundPanel && (
                            <LimitedStandingsTable event={event} />
                        )}

                        {showRoundPanel && tableBlock}
                    </PanelBody>
                )}
            </div>

            <LimitedStartUnseatedDialog
                open={confirmStartUnseated}
                onOpenChange={setConfirmStartUnseated}
                onConfirm={handleConfirmStartUnseated}
                pending={pending}
            />

            <GameDialog
                open={confirmLeave}
                onOpenChange={setConfirmLeave}
                title={seatingOpen ? "Leave this Seat?" : "Leave this event?"}
                subtitle={
                    seatingOpen
                        ? "It returns to open — anyone else can take it. This action cannot be undone."
                        : "You drop out for good: your remaining Picks are made for you and every remaining Match is conceded. This action cannot be undone."
                }
            >
                <div className="mt-4 flex justify-end gap-2">
                    <ActionButton
                        onClick={() => setConfirmLeave(false)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={handleLeave}
                        label="Leave Event"
                        tone="destructive"
                        disabled={pending}
                    />
                </div>
            </GameDialog>

            <GameDialog
                open={confirmCancel}
                onOpenChange={setConfirmCancel}
                title={seatingOpen ? "Cancel this event?" : "Close this event?"}
                subtitle={
                    seatingOpen
                        ? "This removes it for every seated player. This action cannot be undone."
                        : "This ends the event now. Pools, decks, Rounds and results already recorded stay intact — nothing new can be played. This action cannot be undone."
                }
            >
                <div className="mt-4 flex justify-end gap-2">
                    <ActionButton
                        onClick={() => setConfirmCancel(false)}
                        label="Keep Event"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={handleCancel}
                        label={seatingOpen ? "Cancel Event" : "Close Event"}
                        tone="destructive"
                        disabled={pending}
                    />
                </div>
            </GameDialog>
        </LimitedEventPageFrame>
    );
}
