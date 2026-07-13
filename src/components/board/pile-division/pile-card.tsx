// A single face-up card on the pile-division stage. Absolutely positioned from
// the layout map; the only mid-drag mutation is its transform (stable DOM node,
// so pointer capture is never dropped). Transform transitions when settling
// into a zone, snaps instantly while dragging.
import { getImageFallbackUrl, getImageSrcSet, getImageUrl } from "~/lib/images";
import type { CardInstance } from "~/types/game";
import { CARD_W, CARD_H } from "./layout";

export default function PileCard({
    card,
    x,
    y,
    dragging,
    interactive,
    onPointerDown,
}: {
    card: CardInstance;
    x: number;
    y: number;
    dragging: boolean;
    interactive: boolean;
    onPointerDown: (e: React.PointerEvent) => void;
}) {
    const defId = card.card.id;
    return (
        <div
            onPointerDown={onPointerDown}
            className="absolute top-0 left-0 touch-none"
            style={{
                width: CARD_W,
                height: CARD_H,
                transform: `translate(${x}px, ${y}px)${dragging ? " scale(1.05)" : ""}`,
                transition: dragging ? "none" : "transform 180ms ease-out",
                zIndex: dragging ? 50 : 1,
                cursor: interactive
                    ? dragging
                        ? "grabbing"
                        : "grab"
                    : "default",
            }}
        >
            <img
                src={getImageUrl(defId)}
                srcSet={getImageSrcSet(defId)}
                sizes={`${CARD_W}px`}
                onError={(e) => {
                    const fallback = getImageFallbackUrl(defId);
                    if (e.currentTarget.src !== fallback) {
                        e.currentTarget.srcset = "";
                        e.currentTarget.src = fallback;
                    }
                }}
                alt=""
                draggable={false}
                className="pointer-events-none select-none rounded-[7%] border border-border object-cover shadow-md"
                style={{
                    width: CARD_W,
                    height: CARD_H,
                    boxShadow: dragging
                        ? "0 12px 28px rgba(0,0,0,0.6)"
                        : undefined,
                }}
            />
        </div>
    );
}
