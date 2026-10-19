// Placement of the beside-the-card anchored Card Preview (issue #5664). Pure
// layout, no DOM access: the caller passes the anchor's rect, the panel's
// measured size and the viewport size, so the full-visibility contract is
// testable without a layout engine.

export const ANCHORED_PREVIEW_GAP = 8;
export const ANCHORED_PREVIEW_VIEWPORT_PAD = 8;

export type AnchorRect = Pick<DOMRect, "top" | "left" | "right" | "height">;

export type Viewport = { width: number; height: number };

/** Clamp the preview so it sits next to the anchored card without ever
 *  overflowing the viewport. Prefers the right side, falls back to the left,
 *  and otherwise picks whichever side has more room. */
export function clampAnchoredPreviewPosition(
    cardRect: AnchorRect,
    width: number,
    height: number,
    viewport: Viewport
): { top: number; left: number } {
    const pad = ANCHORED_PREVIEW_VIEWPORT_PAD;
    const gap = ANCHORED_PREVIEW_GAP;
    const { width: vw, height: vh } = viewport;

    let left: number;
    const fitsRight = cardRect.right + gap + width <= vw - pad;
    const fitsLeft = cardRect.left - gap - width >= pad;
    if (fitsRight) {
        left = cardRect.right + gap;
    } else if (fitsLeft) {
        left = cardRect.left - gap - width;
    } else {
        const gapRight = vw - cardRect.right;
        const gapLeft = cardRect.left;
        left =
            gapRight >= gapLeft
                ? cardRect.right + gap
                : cardRect.left - gap - width;
    }
    left = Math.max(pad, Math.min(left, vw - pad - width));

    // Bottom clamp first, top clamp last: a panel taller than the viewport
    // pins to the top pad and its `maxHeight` cap keeps the bottom on screen.
    const cardCenterY = cardRect.top + cardRect.height / 2;
    const maxTop = vh - pad - height;
    const top = Math.max(pad, Math.min(cardCenterY - height / 2, maxTop));

    return { top, left };
}
