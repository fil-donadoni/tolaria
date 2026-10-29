import type { CardInstance } from "~/types/game";
import CardImage from "./card-image";

/** A stack item's card face. The layer-5 colour ring (CR 613.1e) is drawn by
 *  `CardImage` itself (`ColorRingOverlay`), as in every other zone. */
export default function StackCardImage({
    card,
    showCopyBadge,
    sizes,
    includeThumb,
}: {
    card: CardInstance;
    /** Spell copy on the stack (CR 707.10) — forwarded to the preview badge. */
    showCopyBadge?: boolean;
    /** `sizes` hint forwarded to CardImage (the stack renders at w-32 → 128px). */
    sizes?: string;
    /** Forwarded to CardImage — the stack is a mid slot, so thumb is excluded. */
    includeThumb?: boolean;
}) {
    return (
        <div className="relative">
            <CardImage
                card={card}
                showCopyBadge={showCopyBadge}
                sizes={sizes}
                includeThumb={includeThumb}
            />
        </div>
    );
}
