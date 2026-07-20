import { useCallback, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import CardPreviewBody, {
    type CardPreviewBodyProps,
} from "./card-preview-body";

// Beside-the-card preview placement for surfaces that are NOT the in-game board
// (the lobby and the deck builder). Whereas the board docks the preview in its
// fixed right column (CardPreviewDock), here there is no board chrome to dodge,
// so the preview reads better floated next to the hovered card — its original
// placement before the #332 dock. The position is clamped to the viewport and
// measured post-mount because the panel's height varies with oracle-text
// length. Asserted by tests via the `data-card-preview-anchored` marker.
const DOCK_WIDTH = 128 * 2;
const GAP = 8;
const VIEWPORT_PAD = 8;

// Clamp the preview so it sits next to the anchored card without ever
// overflowing the viewport. Prefers the right side, falls back to the left, and
// otherwise picks whichever side has more room (CR-agnostic — pure layout).
function clampPosition(
    cardRect: DOMRect,
    width: number,
    height: number
): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    const fitsRight = cardRect.right + GAP + width <= vw - VIEWPORT_PAD;
    const fitsLeft = cardRect.left - GAP - width >= VIEWPORT_PAD;
    if (fitsRight) {
        left = cardRect.right + GAP;
    } else if (fitsLeft) {
        left = cardRect.left - GAP - width;
    } else {
        const gapRight = vw - cardRect.right;
        const gapLeft = cardRect.left;
        left =
            gapRight >= gapLeft
                ? cardRect.right + GAP
                : cardRect.left - GAP - width;
    }
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - VIEWPORT_PAD - width));

    const cardCenterY = cardRect.top + cardRect.height / 2;
    let top = cardCenterY - height / 2;
    const maxTop = vh - VIEWPORT_PAD - height;
    if (maxTop < VIEWPORT_PAD || top < VIEWPORT_PAD) {
        top = VIEWPORT_PAD;
    } else if (top > maxTop) {
        top = maxTop;
    }

    return { top, left };
}

type CardPreviewAnchoredProps = CardPreviewBodyProps & {
    /** The hovered card's container, used as the positioning anchor. */
    anchorRef: RefObject<HTMLDivElement | null>;
};

export default function CardPreviewAnchored({
    anchorRef,
    ...body
}: CardPreviewAnchoredProps) {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [measured, setMeasured] = useState(false);
    // A copy permanent shows two faces (Current + Original) — double the width;
    // the viewport-clamp below keeps it on screen.
    const width = body.originalBody ? DOCK_WIDTH * 2 : DOCK_WIDTH;

    // Callback ref measures synchronously when the panel mounts, so the first
    // paint already has the correct (clamped) position. Variable-height oracle
    // text never overflows the viewport.
    const measureRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return;
            const anchor = anchorRef.current;
            if (!anchor) return;
            const cardRect = anchor.getBoundingClientRect();
            const panelRect = node.getBoundingClientRect();
            setPosition(
                clampPosition(cardRect, panelRect.width, panelRect.height)
            );
            setMeasured(true);
        },
        [anchorRef]
    );

    return createPortal(
        <div
            ref={measureRef}
            data-card-preview-anchored
            className="pointer-events-none fixed z-modal flex flex-col rounded-2xl shadow-2xl bg-surface overflow-hidden"
            style={{
                top: position.top,
                left: position.left,
                width,
                maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
                opacity: measured ? 1 : 0,
            }}
        >
            <CardPreviewBody {...body} />
        </div>,
        document.body
    );
}
