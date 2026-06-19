import { useMemo } from "react";
import type { Player } from "~/types/game";
import { portraitHandScrolls } from "~/lib/board-layout";
import BoardNextCard from "./board-next-card";
import BoardNextHandCard from "./board-next-hand-card";

type BoardNextHandPortraitProps = {
    /** The hand owner. */
    player: Player;
    /** True for the viewer's own hand — its cards are interactive (click +
     *  drag-to-cast / play). The opponent's hand is presentational (backs). */
    interactive: boolean;
    "data-testid"?: string;
};

/** Fixed card width for the portrait flat-overlap hand (px). Small enough that
 *  up to the scroll threshold fits a ~360-390px viewport, large enough to stay
 *  legible. */
const PORTRAIT_CARD_W = 76;
/** Overlap between adjacent cards (px) — a flat overlap, not a fanned arc. */
const PORTRAIT_OVERLAP = 26;

/** Portrait hand (#336). On a phone the fanned-arc {@link BoardNextHand} crams
 *  cards into thin slivers as the hand grows. This is a FLAT overlap instead:
 *  cards sit in a single row with a constant overlap, and once the hand holds
 *  MORE THAN six cards the row scrolls HORIZONTALLY ({@link portraitHandScrolls})
 *  so each card keeps a legible width rather than overlapping further. At or
 *  below six the row lays out without a scroll (`overflow-x-hidden`, centered).
 *
 *  Drag-to-cast / play and the long-press preview ride along unchanged via the
 *  same {@link BoardNextHandCard} / {@link BoardNextCard} the spatial hand uses —
 *  this is a layout fork only. The opponent's hand renders as backs. View layer
 *  only. */
export default function BoardNextHandPortrait({
    player,
    interactive,
    "data-testid": testId,
}: BoardNextHandPortraitProps) {
    const scrolls = portraitHandScrolls(player.hand.length);

    const items = useMemo(
        () =>
            player.hand.map((card, i) => ({
                key: card ? card.id : `hidden-${player.id}-${i}`,
                card,
            })),
        [player.hand, player.id]
    );

    return (
        <div
            data-testid={testId}
            data-hand-scrolls={scrolls ? "true" : "false"}
            className={`flex h-full items-end ${
                scrolls
                    ? "justify-start overflow-x-auto"
                    : "justify-center overflow-x-hidden"
            }`}
            style={{ scrollbarWidth: "none" }}
        >
            <div className="flex w-max items-end px-3">
                {items.map(({ key, card }, i) => (
                    <div
                        key={key}
                        className="shrink-0"
                        style={{
                            width: PORTRAIT_CARD_W,
                            aspectRatio: "5 / 7",
                            marginLeft: i === 0 ? 0 : -PORTRAIT_OVERLAP,
                        }}
                    >
                        {interactive && card ? (
                            <BoardNextHandCard card={card} />
                        ) : (
                            <BoardNextCard card={card} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
