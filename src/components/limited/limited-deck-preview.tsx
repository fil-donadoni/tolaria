import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useLimitedSeatDeck } from "~/hooks/useLimitedSeatDeck";
import { groupDeckCards } from "~/lib/limited/limitedReviewGroups";
import { cn } from "~/lib/utils";
import ActionButton from "~/components/board/action-button";
import LimitedReviewCardGrid from "./limited-review-card-grid";

const PREVIEW_CARD_WIDTH = 64;

/** The viewer's own deck for their Seat during the Games phase (issue #6919):
 *  the cards grouped as in the review tab, the card count, legality (first
 *  rejection reason when illegal) and the Edit Deck CTA into the builder. The
 *  CTA is never gated on `hasDeck` — same stranded-player reasoning as
 *  `LimitedYourDeckPanel`. */
export default function LimitedDeckPreview({
    eventId,
    seatIndex,
}: {
    eventId: Id<"limitedEvents">;
    seatIndex: number;
}) {
    const navigate = useNavigate();
    const deck = useLimitedSeatDeck(eventId, seatIndex);
    const groups = useMemo(
        () => (deck ? groupDeckCards(deck.cards) : []),
        [deck]
    );
    const illegal = deck !== undefined && !deck.isLegal;

    return (
        <div
            data-slot="deck-preview"
            className={cn(
                "flex min-w-0 flex-col gap-2 rounded-sm border px-3 py-3",
                illegal
                    ? "border-danger/50 bg-danger/5"
                    : "border-accent/40 bg-accent/5"
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                        Your deck
                        {deck !== undefined && ` · ${deck.cards.length} cards`}
                    </h3>
                    <span className="text-xs text-text-muted">
                        {deck === undefined
                            ? "No deck built yet."
                            : illegal
                              ? (deck.reasons[0]?.message ??
                                "It doesn't meet the Limited deck rules yet.")
                              : "Legal"}
                    </span>
                </div>
                <ActionButton
                    onClick={() =>
                        void navigate({
                            to: "/limited/$eventId/build",
                            params: { eventId },
                        })
                    }
                    label={deck === undefined ? "Build Deck" : "Edit Deck"}
                    tone="primary"
                />
            </div>
            {groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                        {group.label}
                    </span>
                    <LimitedReviewCardGrid
                        cards={group.cards}
                        zoom={PREVIEW_CARD_WIDTH}
                    />
                </div>
            ))}
        </div>
    );
}
