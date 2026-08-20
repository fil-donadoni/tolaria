import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { areDraftPicksLegal } from "@convex/limited/eventStatus";
import { passDirection } from "@convex/limited/draftEngine";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useLimitedEvent } from "~/hooks/useLimitedEvent";
import { useViewportMode } from "~/hooks/useViewportMode";
import { limitedEventName } from "~/lib/limitedEventName";
import { cn } from "~/lib/utils";
import { PanelHeader, PanelBody } from "~/components/ui/panel";
import { Button } from "@/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import ErrorState from "~/components/ui/error-state";
import LimitedEventPageFrame from "./limited-event-page-frame";
import LimitedDraftBar from "./limited-draft-bar";
import LimitedDraftTable from "./limited-draft-table";
import LimitedDraftPool from "./limited-draft-pool";
import LimitedTableRing from "./limited-table-ring";

/**
 * The Draft Room (issue #2587, PRD #2405 slice 8, ADR 0101 §6) — the pick
 * screen as its own immersive route, `/limited/$eventId/draft`.
 *
 * It used to be a block INSIDE the event page, which is what issue #2515 was
 * fighting: the event's title, badges, seat list and Close Event button pushed
 * the first pack card to 86% of a landscape phone screen, and the fix there
 * was to fold the chrome away on a compact viewport. That whole mechanism is
 * superseded here — the chrome the room does not want is not collapsed, it is
 * on a different route.
 *
 * WHAT THE ROOM OWNS:
 *  - its own chrome. `SHELL_ROUTE_RULES` registers this route `ownChrome`, so
 *    the shell renders NO band at all and `LimitedDraftBar` is the only bar.
 *    That is what makes ADR 0101's "no Event back-link during a pick" true
 *    rather than aspirational: leaving is in the bar's overflow.
 *  - the layout regime. Tablet/desktop get pack | pool side by side (the Peek
 *    Panel supplies the preview rail — it is `fixed`, and `LimitedDraftTable`
 *    reserves its width). Phone portrait and phone landscape each get their
 *    own two-stop snap arrangement (issue #2588, ADR 0101 §6): the room
 *    RESOLVES which one and hands it down as a layout, and gives the phone
 *    body a fixed box instead of a scroller so a snap pane can be a definite
 *    fraction of it.
 *
 * SEALED USES THE ROOM IN REVEAL MODE (ADR 0101 §6): there is no pack and no
 * pass, so the bar drops its counters and the body is the dealt Pool with the
 * way into the builder.
 */
export default function LimitedDraftRoom({
    eventId,
}: {
    eventId: Id<"limitedEvents">;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const event = useLimitedEvent(eventId);
    const viewport = useViewportMode();
    const [poolVisible, setPoolVisible] = useState(true);
    const [tableOpen, setTableOpen] = useState(false);

    const viewerSeat =
        user && event
            ? event.seats.find((s) => s.userId === user._id)
            : undefined;

    // Every phase question through `eventStatus.ts` (ADR 0076), never a raw
    // `status ===`.
    const draftLive =
        event != null &&
        event.type === "draft" &&
        areDraftPicksLegal(event.status) &&
        event.draftCompletedAt === undefined;
    // Sealed uses the room in REVEAL mode (ADR 0101 §6). Same phase fact as
    // the draft's, deliberately: `draftPicksLegal` is the draft/deckbuild
    // phase, which is exactly when a Sealed seat has a pool to be shown and
    // nothing has been played yet. Once the rounds run there is nothing to
    // reveal — the event page and the builder own that.
    const revealMode =
        event != null &&
        event.type !== "draft" &&
        areDraftPicksLegal(event.status);

    // The room has nothing to show: no seat here, or the draft is over (the
    // event page's `useAutoOpenLimitedBuilder` takes that player into the
    // builder, which is where the end of a draft actually leads). `replace`
    // so a bounced visit does not leave a dead room in the history stack.
    //
    // This CANNOT ping-pong with `useDraftRoomRedirect` on the event page: it
    // fires exactly when that one does not (`draftLive` is the same
    // predicate), and that one is additionally one-shot per tab.
    const leave =
        event != null &&
        user !== undefined &&
        (viewerSeat === undefined || (!draftLive && !revealMode));
    useEffect(() => {
        if (!leave) return;
        void navigate({
            to: "/limited/$eventId",
            params: { eventId },
            replace: true,
        });
    }, [leave, eventId, navigate]);

    if (event === undefined || user === undefined) {
        return <LoadingScreen />;
    }

    if (event === null) {
        return (
            <LimitedEventPageFrame>
                <PanelHeader title="Draft" />
                <PanelBody>
                    <ErrorState
                        message="This event no longer exists — it may have been cancelled."
                        action={
                            <Button
                                variant="link"
                                size="sm"
                                onClick={() =>
                                    void navigate({ to: "/limited" })
                                }
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

    if (leave || !viewerSeat) {
        // The effect above is already navigating away; render the loading
        // screen rather than a flash of an empty room. (`!viewerSeat` is
        // implied by `leave` — TypeScript needs it said out loud to narrow.)
        return <LoadingScreen />;
    }

    // The room's ONE viewport branch (ADR 0101 §6). Issue #2587 shipped it as
    // a binary — desktop split vs everything-else stacked — which folded the
    // two phone regimes together; issue #2588 gives each its own arrangement.
    // Resolved HERE and passed down: `LimitedDraftTable` forks on the LAYOUT
    // it is told, never on a media query of its own, so a test can drive
    // either arrangement and the room stays the single place the regime is
    // decided.
    const draftTableLayout =
        viewport === "desktop"
            ? "split"
            : viewport === "portrait"
              ? "phone-portrait"
              : "phone-landscape";
    const draftPhone = draftLive && viewport !== "desktop";

    const round = event.draftRound ?? 0;
    const pack = viewerSeat.currentPack ?? [];
    const pool = viewerSeat.pool ?? [];

    return (
        <div className="flex flex-1 min-h-0 flex-col bg-surface-base text-text">
            <LimitedDraftBar
                eventId={eventId}
                title={limitedEventName(event)}
                pack={
                    draftLive
                        ? {
                              round,
                              totalRounds: event.packSlots.length,
                              cardsLeft: pack.length,
                              picksMade: pool.length,
                              queueCount: viewerSeat.packQueueCount ?? 0,
                              direction: passDirection(round),
                          }
                        : null
                }
                poolVisible={poolVisible}
                onTogglePool={() => setPoolVisible((v) => !v)}
                onOpenTable={() => setTableOpen(true)}
            />

            {/* The body is a SCROLLER off the phone regimes and a fixed box on
                them (issue #2588). A snap pane has to be exactly its share of
                a definite height, so the surface underneath cannot also be
                free to grow — and the 12px of padding a scrolling body wants
                is 12px the two panes would be measured against. Every other
                regime keeps the scroller #2587 gave it verbatim. */}
            <div
                data-slot="draft-room-body"
                className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    draftPhone ? "overflow-hidden" : "overflow-y-auto p-3"
                )}
            >
                {draftLive ? (
                    <LimitedDraftTable
                        eventId={eventId}
                        seat={viewerSeat}
                        round={round}
                        layout={draftTableLayout}
                        showPool={poolVisible}
                    />
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="heading-panel text-base tracking-[0.16em] uppercase">
                                Your Sealed Pool ({pool.length})
                            </h2>
                            <Link
                                to="/limited/$eventId/build"
                                params={{ eventId }}
                                className="rounded-sm px-2 py-1 text-xs tracking-[0.14em] text-accent-strong uppercase transition-colors hover:text-parchment"
                            >
                                Build your deck →
                            </Link>
                        </div>
                        {poolVisible && (
                            <LimitedDraftPool
                                eventId={eventId}
                                pool={pool}
                                arrangement={viewerSeat.poolArrangement}
                            />
                        )}
                    </div>
                )}
            </div>

            <LimitedTableRing
                open={tableOpen}
                onOpenChange={setTableOpen}
                event={event}
                round={round}
            />
        </div>
    );
}
