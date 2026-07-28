// A single face-up card in the ordered picker. Presentational: renders the card
// art from its definition id (the picker tracks the INSTANCE id separately for
// ordering/submit). Pointer events are owned by the picker's strip container, so
// the image itself is inert.
import { getImageFallbackUrl, getImageSrcSet, getImageUrl } from "~/lib/images";
import {
    CARD_W as CARD_W_NATURAL,
    CARD_H as CARD_H_NATURAL,
} from "./constants";

export default function OrderCard({
    defId,
    cardW = CARD_W_NATURAL,
    cardH = CARD_H_NATURAL,
}: {
    defId: string;
    /** Live (possibly responsive, issue #1765) render size — defaults to the
     *  natural desktop size. The picker passes its fitted tile size so every
     *  card in the strip stays in sync with the library mock beside it. */
    cardW?: number;
    cardH?: number;
}) {
    return (
        <img
            src={getImageUrl(defId)}
            srcSet={getImageSrcSet(defId)}
            sizes={`${cardW}px`}
            onError={(e) => {
                // WebP rendition missing → retry as jpg. srcset must be
                // cleared too (it outranks src) and the guard stops the swap
                // loop when the jpg is missing as well.
                const fallback = getImageFallbackUrl(defId);
                if (e.currentTarget.src !== fallback) {
                    e.currentTarget.srcset = "";
                    e.currentTarget.src = fallback;
                }
            }}
            alt=""
            draggable={false}
            className="pointer-events-none select-none rounded-[7%] border border-border object-cover shadow-md"
            style={{ width: cardW, height: cardH }}
        />
    );
}
