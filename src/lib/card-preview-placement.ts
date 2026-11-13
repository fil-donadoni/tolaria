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

// Hover preview dock side (issue #8955). The dock is a fixed panel on the
// viewport's right edge; a card whose rect intersects that band would be
// covered by the very panel it opened, so the dock moves to the left edge.
// Horizontal test only: the band's vertical extent depends on a CSS variable
// (`--preview-bottom-safe`) that pure layout code cannot read.

export const DOCK_WIDTH = 360;
/** Gap between the dock and the viewport edge it is docked to. */
export const DOCK_EDGE_INSET = 8;

export type DockSide = "right" | "left";

/** Dock panel width: a copy permanent shows two faces (Current + Original). */
export function dockWidth(hasOriginal: boolean): number {
    return hasOriginal ? DOCK_WIDTH * 2 : DOCK_WIDTH;
}

/** Side to dock on, decided when the dock opens: `left` iff the hovered card
 *  intersects the right-edge band (issue #8955), OR one of `keepClear` does
 *  while the left band is free of them all (issue #9500). `keepClear` is the
 *  hovered card's lit relationship — the planeswalker an attacker is
 *  attacking, the attackers of a hovered target — so the dock never covers
 *  the other end of the arrow the player is reading. */
export function chooseDockSide(
    cardRect: Pick<DOMRect, "left" | "right">,
    width: number,
    viewport: Viewport,
    keepClear: ReadonlyArray<Pick<DOMRect, "left" | "right">> = []
): DockSide {
    const rightBand = {
        left: viewport.width - DOCK_EDGE_INSET - width,
        right: viewport.width,
    };
    const leftBand = { left: 0, right: DOCK_EDGE_INSET + width };
    const hits = (
        r: Pick<DOMRect, "left" | "right">,
        band: { left: number; right: number }
    ) => r.right > band.left && r.left < band.right;
    if (hits(cardRect, rightBand)) return "left";
    const relatedRight = keepClear.some((r) => hits(r, rightBand));
    const relatedLeft = keepClear.some((r) => hits(r, leftBand));
    return relatedRight && !relatedLeft ? "left" : "right";
}

/** The on-screen rects of the board nodes a hover highlight lit (issue
 *  #9500): permanents, players, stack items — by their arrow anchors. */
export function litNodeRects(
    nodes: Iterable<string> | null | undefined,
    exceptEl?: Element | null
): DOMRect[] {
    if (!nodes) return [];
    const rects: DOMRect[] = [];
    for (const id of nodes) {
        const sel = ["permanent", "player", "stack"]
            .map((k) => `[data-arrow-anchor-${k}="${CSS.escape(id)}"]`)
            .join(",");
        for (const el of document.querySelectorAll(sel)) {
            if (exceptEl && (el === exceptEl || exceptEl.contains(el)))
                continue;
            rects.push(el.getBoundingClientRect());
        }
    }
    return rects;
}
