import { useState } from "react";
import { createColumnLayout, type GroupingKind } from "@convex/deckLayout";
import type {
    LimitedEventSeatView,
    LimitedEventView,
} from "~/hooks/useLimitedEvent";
import type { ZoneCard } from "~/types/game";
import { cardBase } from "~/lib/cardSizing";
import EmptyState from "~/components/ui/empty-state";
import DeckZoneSurface from "~/components/deckbuilder/deck-zone-surface";
import LimitedReviewPickOrder from "./limited-review-pick-order";

/** The review tile size (issue #3167). Smaller than either deckbuilder's base
 *  (`8rem`/`7.5rem`) — this surface is a page SECTION holding up to eight
 *  seats, not a workbench — but through the SAME `cardBase()` floor, so a
 *  short-and-wide viewport can never shrink a face below legibility. */
const REVIEW_CARD_W = cardBase("5.5rem", "11vw", "8dvh");
const REVIEW_CARD_VARS = {
    "--card-w": REVIEW_CARD_W,
    "--card-h": `calc(${REVIEW_CARD_W} * 7 / 5)`,
} as React.CSSProperties;

/** The Sideboard renders as ONE Column and offers no Grouping control (issue
 *  #3167), so its Layout is a module constant rather than state: nothing can
 *  change it. */
const SIDEBOARD_LAYOUT = createColumnLayout({ grouping: "none" });

/** The click every card of this surface does NOT have. `DeckZoneSurface` takes
 *  `onCardClick` unconditionally (every editing host has one), and `readOnly`
 *  is what actually stops the tile binding it — this is the inert value the
 *  prop still needs. Hoisted so it keeps one identity across renders. */
const NO_CARD_CLICK = () => {};

const cardTitle = (card: ZoneCard) => card.cardName;

/** One Seat's row in the compact "Review the Table" summary (PRD #1107 story
 *  26, issue #1116; redesigned issue #1583; card piles issue #3167). Always
 *  shows a tidy summary line (seat, nickname, bot badge, deck colors, maindeck
 *  / sideboard counts) from the ungated `seat.deckSummary`. The detail — the
 *  built deck, the Sideboard, and either the numbered pick order (Draft) or
 *  the Pool (Sealed) — is gated: the server projection populates another
 *  seat's `pool`/`humanDeck` solely for an admin
 *  (`convex/limited/eventProjection.ts`), and this collapses it behind a
 *  per-seat `<details>` disclosure (collapsed by default) so a full table
 *  stays scannable. `showDetail` gates the disclosure to an admin viewer or
 *  the viewer's OWN seat — a bot seat's `autoBuiltDeck` is on the wire for the
 *  vs-AI hookup regardless, so presence of deck data alone must NOT reveal it.
 *
 *  The detail renders through the deckbuilder's OWN zone surface
 *  (`DeckZoneSurface`, ADR 0075), mounted `readOnly`: a finished 40-card deck
 *  read as 40 truncated strings, and a 45-pick draft as 45 numbered ones, when
 *  the identical data already has a card-image arrangement one component away.
 *  Nothing new reaches the wire — card identity resolves client-side from the
 *  `cardId` that was always there. */
export default function LimitedReviewSeat({
    seat,
    eventType,
    isAdmin,
}: {
    seat: LimitedEventSeatView;
    eventType: LimitedEventView["type"];
    isAdmin: boolean;
}) {
    // The Grouping the two grouped blocks bucket by. Component state for the
    // session (issue #3167's own out-of-scope note): never persisted, and
    // never near the deckbuilder's `deckViewPrefs` storage keys — a seat's
    // review is not a workbench whose arrangement anyone returns to. One state
    // per BLOCK, so switching a Sealed Pool's grouping leaves the deck alone.
    const [deckGrouping, setDeckGrouping] = useState<GroupingKind>("mv");
    const [poolGrouping, setPoolGrouping] = useState<GroupingKind>("mv");

    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");
    const summary = seat.deckSummary;
    // Detail (built deck + Pool / pick order) reveals for an admin viewer, or
    // for the viewer's own seat (they always keep access to their own data).
    const showDetail = isAdmin || seat.isViewer;
    const deck = seat.isBot ? seat.autoBuiltDeck : seat.humanDeck;
    const pool = seat.pool ?? [];
    // A DRAFT seat's `pool` array order IS its pick order (`applyPick`
    // appends one entry per Pick, never reorders) — numbered directly, no
    // separate "pick order" field on the wire.
    const isDraft = eventType === "draft";

    const summaryLine = (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                    Seat {seat.seatIndex + 1}
                </span>
                <span className="font-medium text-text">{label}</span>
                {seat.isBot && (
                    <span className="rounded-sm border border-border-subtle/60 px-1.5 py-0.5 text-[10px] tracking-wide uppercase text-text-muted">
                        Bot
                    </span>
                )}
            </div>
            <span className="text-xs text-text-muted">
                {summary
                    ? `${summary.colors.join("/") || "—"} — ${summary.maindeckCount} maindeck / ${summary.sideboardCount} sideboard`
                    : "No deck"}
            </span>
        </div>
    );

    if (!showDetail) {
        return (
            <div className="rounded-sm border border-border-subtle/40 p-3">
                {summaryLine}
            </div>
        );
    }

    return (
        <details className="rounded-sm border border-border-subtle/40 p-3">
            <summary className="cursor-pointer list-none">
                {summaryLine}
            </summary>

            {/* The tile size lives on the disclosure body, so all three blocks
                below draw from ONE declaration — the deckbuilder pair sets the
                same pair of properties per zone, from its zoom sliders. */}
            <div
                className="mt-3 flex flex-col gap-3"
                style={REVIEW_CARD_VARS}
                data-slot="review-seat-detail"
            >
                {deck ? (
                    <>
                        <div
                            className="rounded-sm border border-border-subtle/30"
                            data-slot="review-maindeck"
                        >
                            <DeckZoneSurface
                                zone="maindeck"
                                title="Built Deck"
                                cards={deck.cards}
                                layout={createColumnLayout({
                                    grouping: deckGrouping,
                                })}
                                onGroupingChange={setDeckGrouping}
                                /* `"pane"` on BOTH blocks, though this one is
                                   a Maindeck: the model decides whether empty
                                   Columns render, and `readOnly` has already
                                   taken the drop itself away. A finished deck
                                   with no 6-drop wants no empty 6-drop Column
                                   — there is nothing left to drop into it. */
                                dropModel="pane"
                                filterable={false}
                                readOnly
                                onCardClick={NO_CARD_CLICK}
                                cardTitle={cardTitle}
                                emptyMessage="No maindeck cards."
                            />
                        </div>
                        <div
                            className="rounded-sm border border-border-subtle/30"
                            data-slot="review-sideboard"
                        >
                            <DeckZoneSurface
                                zone="sideboard"
                                title="Sideboard"
                                cards={deck.sideboard}
                                layout={SIDEBOARD_LAYOUT}
                                /* No `onGroupingChange` — the surface's own
                                   presence-is-the-switch convention is what
                                   leaves the Sideboard its single ungrouped
                                   Column and no control. */
                                dropModel="pane"
                                filterable={false}
                                readOnly
                                onCardClick={NO_CARD_CLICK}
                                cardTitle={cardTitle}
                                emptyMessage="No sideboard cards."
                            />
                        </div>
                    </>
                ) : (
                    <div>
                        <h4 className="text-xs font-semibold tracking-wide uppercase text-text-muted">
                            Built Deck
                        </h4>
                        <EmptyState message="No deck submitted." />
                    </div>
                )}

                {isDraft ? (
                    <div data-slot="review-pick-order">
                        <h4 className="text-xs font-semibold tracking-wide uppercase text-text-muted">
                            Pick Order ({pool.length})
                        </h4>
                        {pool.length === 0 ? (
                            <EmptyState message="No Pool." />
                        ) : (
                            <LimitedReviewPickOrder pool={pool} />
                        )}
                    </div>
                ) : (
                    <div
                        className="rounded-sm border border-border-subtle/30"
                        data-slot="review-pool"
                    >
                        <DeckZoneSurface
                            zone="maindeck"
                            title="Pool"
                            /* `LimitedPoolCard` is already a `ZoneCard` — one
                               entry per PHYSICAL card, which is what the piles
                               want: a Sealed Pool holding three Mountains
                               draws three faces. */
                            cards={pool}
                            layout={createColumnLayout({
                                grouping: poolGrouping,
                            })}
                            onGroupingChange={setPoolGrouping}
                            dropModel="pane"
                            filterable={false}
                            readOnly
                            onCardClick={NO_CARD_CLICK}
                            cardTitle={cardTitle}
                            emptyMessage="No Pool."
                        />
                    </div>
                )}
            </div>
        </details>
    );
}
