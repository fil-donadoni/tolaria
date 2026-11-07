// A single face-up card on the pile-division stage. Absolutely positioned from
// the layout map; the only mid-drag mutation is its transform (stable DOM node,
// so pointer capture is never dropped). Transform transitions when settling
// into a zone, snaps instantly while dragging.
import usePrintedFaceSource from "~/hooks/usePrintedFaceSource";
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
    // The image IS the slot: its source comes from the one printed-face
    // contract (issue #3553, issue #8321) — the measured srcset hint, the 1x
    // bitmap, the WebP → jpg fallback — never a hand-declared hint.
    const { slotRef, attrs, onError } = usePrintedFaceSource<HTMLImageElement>({
        imageId: defId,
        fallbackSizes: `${CARD_W}px`,
        fallbackIncludeThumb: true,
    });
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
                ref={slotRef}
                data-card-face="printed"
                {...(attrs ?? {})}
                onError={onError}
                alt=""
                draggable={false}
                className="pointer-events-none select-none card-corner border border-border object-cover shadow-md"
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
