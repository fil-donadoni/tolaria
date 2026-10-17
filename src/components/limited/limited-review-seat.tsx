import { useId, useMemo, useState } from "react";
import type {
    LimitedEventSeatView,
    LimitedEventView,
} from "~/hooks/useLimitedEvent";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { openedPrintId } from "@convex/limited/poolArrangement";
import EmptyState from "~/components/ui/empty-state";
import SegmentedControl from "~/components/ui/segmented-control";
import {
    groupDeckCards,
    pickOrderCards,
    type ReviewCard,
} from "~/lib/limited/limitedReviewGroups";
import { cn } from "~/lib/utils";
import LimitedReviewCardGrid from "./limited-review-card-grid";
import LimitedReviewSeatTrigger from "./limited-review-seat-trigger";
import LimitedReviewZoomSlider from "./limited-review-zoom-slider";

type ReviewTab = "deck" | "picks";

const noCaption = (cards: readonly { cardId: string; cardName: string }[]) =>
    cards.map(
        (c, i): ReviewCard => ({
            key: `${c.cardId}-${i}`,
            cardId: c.cardId,
            cardName: c.cardName,
        })
    );

/** A Pool as the faces its boosters contained (issue #5473): each card's
 *  `cardId` here is the image to render — its opened print, else its own. */
const poolFaces = (pool: readonly LimitedPoolCard[]) =>
    pool.map((c) => ({
        cardId: openedPrintId(c) ?? c.cardId,
        cardName: c.cardName,
    }));

/** One seat of "Review the table" (PRD #1107 story 26; reworked issue #5392):
 *  a collapsible with a large trigger, and inside two tabs — Deck (creatures /
 *  spells / lands with basics collapsed to ×N, then the sideboard) and Pick
 *  order (P1p1…; a Sealed seat's second tab is its Pool, which has no order).
 *  `locked` is the projection's verdict, passed in — never derived here. */
export default function LimitedReviewSeat({
    seat,
    eventType,
    packCount,
    record,
    locked,
    open,
    onToggle,
    zoom,
    onZoom,
}: {
    seat: LimitedEventSeatView;
    eventType: LimitedEventView["type"];
    packCount: number;
    record: string | null;
    locked: boolean;
    open: boolean;
    onToggle: () => void;
    zoom: number;
    onZoom: (zoom: number) => void;
}) {
    const [tab, setTab] = useState<ReviewTab>("deck");
    const panelId = useId();
    const expanded = open && !locked;
    const isDraft = eventType === "draft";
    const deck = seat.isBot ? seat.autoBuiltDeck : seat.humanDeck;
    const pool = seat.pool ?? [];

    const groups = useMemo(
        () => (deck ? groupDeckCards(deck.cards) : []),
        [deck]
    );
    const sideboard = useMemo(
        () => (deck ? noCaption(deck.sideboard) : []),
        [deck]
    );
    const poolCards = useMemo(() => {
        const cards = poolFaces(seat.pool ?? []);
        return isDraft ? pickOrderCards(cards, packCount) : noCaption(cards);
    }, [seat.pool, isDraft, packCount]);

    return (
        <section
            data-slot="review-seat"
            data-seat-index={seat.seatIndex}
            data-locked={locked}
            className={cn(
                "overflow-hidden rounded-(--panel-radius) border bg-surface/80",
                expanded ? "border-accent/50" : "border-border-strong",
                locked && "bg-surface/40"
            )}
        >
            <LimitedReviewSeatTrigger
                seat={seat}
                record={record}
                locked={locked}
                expanded={expanded}
                panelId={panelId}
                onToggle={onToggle}
            />
            {expanded && (
                <div
                    id={panelId}
                    data-slot="review-seat-detail"
                    className="flex flex-col gap-3 border-t border-border-subtle/40 p-3 sm:p-4"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SegmentedControl
                            ariaLabel="Review view"
                            options={[
                                {
                                    value: "deck",
                                    label: `Deck · ${deck?.cards.length ?? 0}`,
                                },
                                {
                                    value: "picks",
                                    label: `${isDraft ? "Pick order" : "Pool"} · ${pool.length}`,
                                },
                            ]}
                            value={tab}
                            onChange={setTab}
                        />
                        <LimitedReviewZoomSlider
                            value={zoom}
                            onChange={onZoom}
                        />
                    </div>
                    {tab === "deck" ? (
                        deck ? (
                            <div
                                data-slot="review-deck"
                                className="flex flex-col gap-3"
                            >
                                {groups.map((group) => (
                                    <div
                                        key={group.id}
                                        data-group={group.id}
                                        className="flex flex-col gap-1.5"
                                    >
                                        <h4 className="text-[10px] font-bold tracking-[0.16em] uppercase text-text-muted">
                                            {group.label}
                                        </h4>
                                        <LimitedReviewCardGrid
                                            cards={group.cards}
                                            zoom={zoom}
                                        />
                                    </div>
                                ))}
                                {sideboard.length > 0 && (
                                    <div
                                        data-group="sideboard"
                                        className="flex flex-col gap-1.5"
                                    >
                                        <h4 className="text-[10px] font-bold tracking-[0.16em] uppercase text-text-muted">
                                            Sideboard · {sideboard.length}
                                        </h4>
                                        <LimitedReviewCardGrid
                                            cards={sideboard}
                                            zoom={zoom}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <EmptyState message="No deck submitted." />
                        )
                    ) : pool.length === 0 ? (
                        <EmptyState message="No Pool." />
                    ) : (
                        <div
                            data-slot={
                                isDraft ? "review-pick-order" : "review-pool"
                            }
                        >
                            <LimitedReviewCardGrid
                                cards={poolCards}
                                zoom={zoom}
                                ordered={isDraft}
                            />
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
