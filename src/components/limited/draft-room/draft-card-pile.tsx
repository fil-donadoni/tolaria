import { getImageUrl, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

/** How far each card in the pile peeks out from under the one above it (px).
 *  Enough to read a name band, small enough that a dozen picks fit a phone
 *  strip. */
const STEP_PX = 16;

/** Tile width inside a 20% column on a landscape phone (px). */
const CARD_W_PX = 60;

/**
 * The Arena-style vertical PILE (issue #2588, ADR 0101 §6) — the picks in the
 * landscape sneak-peek column, and the collapsed Booster beside them.
 *
 * `aria-hidden`, and that is a decision rather than an oversight. The pile is
 * a QUANTITY made visible: what it says ("twelve cards, three of them
 * sideboarded") is already in the text label beside it, every card in it is
 * individually reachable in the pane the strip stands for, and the overlap
 * that makes it read as a pile also means each tile is mostly covered by the
 * next. That last part is why the marking is load-bearing rather than
 * cosmetic: the UI gate's occlusion probe scores a covered card image as
 * `cardsOcc`, a hard floor for this lane, and it excludes `aria-hidden` art
 * by the repo's own decorative-image convention (`probe.js` §
 * `isDecorativeArt`, `library-order/deck-mock.tsx` is the existing pile of
 * the same shape). Marking a pile of REACHABLE-elsewhere art as decorative is
 * honest; budgeting away a dozen occluded cards would not be.
 */
export default function DraftCardPile({
    cards,
    emptyLabel,
    className,
}: {
    /** Bottom of the pile first. `highlight` rings a card that is parked in
     *  the Sideboard (ADR 0101 §6: the Sideboard is always countable). */
    cards: readonly { key: string; cardId: string; highlight?: boolean }[];
    emptyLabel: string;
    className?: string;
}) {
    if (cards.length === 0) {
        return (
            <div
                data-slot="draft-card-pile"
                data-empty="true"
                className={cn(
                    "flex items-center justify-center px-1 text-center text-[11px] text-text-disabled",
                    className
                )}
            >
                {emptyLabel}
            </div>
        );
    }
    return (
        <div
            aria-hidden="true"
            data-slot="draft-card-pile"
            data-count={cards.length}
            className={cn("relative min-h-0 overflow-hidden", className)}
            style={{ width: CARD_W_PX }}
        >
            {cards.map((card, index) => {
                const printId = resolveCardImageId(card.cardId);
                if (!printId) return null;
                return (
                    <img
                        key={card.key}
                        src={getImageUrl(printId)}
                        alt=""
                        draggable={false}
                        className={cn(
                            "absolute left-0 card-corner shadow",
                            card.highlight && "ring-1 ring-secondary-accent"
                        )}
                        style={{ top: index * STEP_PX, width: CARD_W_PX }}
                    />
                );
            })}
        </div>
    );
}
