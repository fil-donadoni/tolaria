// A single face-up card in the ordered picker. Presentational: renders the card
// art from its definition id (the picker tracks the INSTANCE id separately for
// ordering/submit). Pointer events are owned by the picker's strip container, so
// the image itself is inert.
import { getImageUrl } from "~/lib/images";
import { CARD_W, CARD_H } from "./constants";

export default function OrderCard({ defId }: { defId: string }) {
    return (
        <img
            src={getImageUrl(defId)}
            alt=""
            draggable={false}
            className="pointer-events-none select-none rounded-[7%] border border-border object-cover shadow-md"
            style={{ width: CARD_W, height: CARD_H }}
        />
    );
}
