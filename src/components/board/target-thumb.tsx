import CardImage from "~/components/cards/card-image";
import type { CardInstance } from "~/types/game";

/** Card aspect ratio (height / width) of a thumbnail box. */
const CARD_RATIO = 1.395;

/** A small card thumbnail naming a target or a targeting source (issue
 *  #9326): the real `CardImage` at a fixed width, hover preview included.
 *  Information only — no ring, no glow, default cursor: the white ring stays
 *  reserved for cards the player can interact with. */
export default function TargetThumb({
    card,
    width,
}: {
    card: CardInstance;
    width: number;
}) {
    return (
        <span
            className="relative block shrink-0 cursor-default overflow-hidden rounded-[6%]"
            style={{ width, height: width * CARD_RATIO }}
        >
            <CardImage card={card} sizes={`${width}px`} includeThumb />
        </span>
    );
}
