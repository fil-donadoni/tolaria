// A single face-up card in the ordered picker. Presentational: renders the card
// art from its definition id (the picker tracks the INSTANCE id separately for
// ordering/submit). Pointer events are owned by the picker's strip container, so
// the image itself is inert. The image IS the slot: its source comes from the
// one printed-face contract (issue #3553, issue #8321) — the measured srcset
// hint, the 1x bitmap, the WebP → jpg fallback — never a hand-declared hint.
import usePrintedFaceSource from "~/hooks/usePrintedFaceSource";
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
    const { slotRef, attrs, onError } = usePrintedFaceSource<HTMLImageElement>({
        imageId: defId,
        fallbackSizes: `${cardW}px`,
        fallbackIncludeThumb: true,
    });
    return (
        <img
            ref={slotRef}
            data-card-face="printed"
            {...(attrs ?? {})}
            onError={onError}
            alt=""
            draggable={false}
            className="pointer-events-none select-none card-corner border border-border object-cover shadow-md"
            style={{ width: cardW, height: cardH }}
        />
    );
}
