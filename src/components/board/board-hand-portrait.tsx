import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Player } from "~/types/game";
import { portraitHandScrolls } from "~/lib/board-layout";
import { SLOT_SPRING } from "~/lib/board-motion";
import { portraitHandMetrics } from "~/lib/portrait-board-bands";
import BoardCard from "./board-card";
import BoardHandCard from "./board-hand-card";

type BoardHandPortraitProps = {
    /** The hand owner. */
    player: Player;
    /** True for the viewer's own hand — its cards are interactive (click +
     *  drag-to-cast / play). The opponent's hand is presentational (backs). */
    interactive: boolean;
    /** Board height (px), for deriving the card footprint so it never exceeds
     *  the hand band's actual height (#1770 follow-up from #1790: a fixed
     *  card overflowed the band on boards under ~665px). Omitted ⇒ the
     *  historical unclamped max — every existing hand-only test exercises
     *  this default and keeps rendering the same 76px card. */
    boardHeight?: number;
    /** Which portrait hand band hosts this strip (#1875): the opponent's is a
     *  smaller band (backs only), so its card footprint derives from that
     *  band's own height. Defaults to the viewer's band — every existing
     *  hand test and the viewer mount keep their exact previous sizing. */
    seat?: "viewer" | "opponent";
    "data-testid"?: string;
};

/** Portrait hand (#336). On a phone the fanned-arc {@link BoardHand} crams
 *  cards into thin slivers as the hand grows. This is a FLAT overlap instead:
 *  cards sit in a single row with a constant overlap, and once the hand holds
 *  MORE THAN six cards the row scrolls HORIZONTALLY ({@link portraitHandScrolls})
 *  so each card keeps a legible width rather than overlapping further. At or
 *  below six the row lays out without a scroll (`overflow-x-hidden`, centered).
 *
 *  Drag-to-cast / play and the long-press preview ride along unchanged via the
 *  same {@link BoardHandCard} / {@link BoardCard} the spatial hand uses —
 *  this is a layout fork only. The opponent's hand renders as backs. View layer
 *  only. */
export default function BoardHandPortrait({
    player,
    interactive,
    boardHeight = Number.POSITIVE_INFINITY,
    seat = "viewer",
    "data-testid": testId,
}: BoardHandPortraitProps) {
    const scrolls = portraitHandScrolls(player.hand.length);
    const reduceMotion = useReducedMotion();
    const { cardWidth, overlap } = portraitHandMetrics(boardHeight, seat);

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
                            width: cardWidth,
                            aspectRatio: "5 / 7",
                            marginLeft: i === 0 ? 0 : -overlap,
                        }}
                    >
                        {interactive && card ? (
                            // Shared-layout identity for the viewer's own cards:
                            // the layoutId matches the battlefield/stack slots
                            // so a card played from the portrait hand flies to
                            // its destination instead of teleporting (#252
                            // extended to portrait). No `layout` prop — the row
                            // scrolls horizontally, and layout-on-render would
                            // fight both the scroll and the drag-to-cast lift.
                            <motion.div
                                layoutId={card.id}
                                data-flight-id={card.id}
                                transition={
                                    reduceMotion
                                        ? { duration: 0 }
                                        : SLOT_SPRING.motion
                                }
                                className="w-full h-full"
                            >
                                {/* Small slot — keep `thumb`, accurate hint. */}
                                <BoardHandCard
                                    card={card}
                                    sizes={`${cardWidth}px`}
                                    includeThumb
                                    // This row scrolls horizontally past the
                                    // threshold (#336) — a touch swipe over a
                                    // card is the only way to reach cards past
                                    // the right edge, so it must not disable
                                    // native panning (issue #1994).
                                    allowHorizontalPan
                                />
                            </motion.div>
                        ) : (
                            <BoardCard card={card} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
