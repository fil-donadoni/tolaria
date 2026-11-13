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

// Hover preview dock side (issues #8955, #9500). The dock is a fixed panel on
// the viewport's right edge by default; it moves to the left edge when it
// would cover what the player is reading:
// - a battlefield permanent the board itself places in the right-edge band
//   (the back row's right block: planeswalkers, battles, noncreature
//   artifacts / enchantments) — the board says so (`preferred`), by effective
//   type, so this file never re-derives a type list;
// - a card OFF the battlefield (a zone pile, the hand, the stack) whose rect
//   intersects the right band (issue #8955);
// - the hovered card's lit relationship (the planeswalker an attacker
//   attacks, the attackers of a hovered target) when one of its nodes sits
//   in the right band and none in the left band (issue #9500).
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

/** Where the hovered card sits, as far as the dock cares. */
export type DockAnchor =
    /** The board asked for the left dock (back row, right block). */
    | { kind: "preferred-left" }
    /** Any other battlefield permanent: its own rect never moves the dock. */
    | { kind: "battlefield" }
    /** Off the battlefield: its rect is tested against the right band. */
    | { kind: "elsewhere"; rect: Pick<DOMRect, "left" | "right"> };

type Span = Pick<DOMRect, "left" | "right">;

function intersects(r: Span, band: Span): boolean {
    return r.right > band.left && r.left < band.right;
}

/** Side to dock on, decided when the dock opens (see the block comment). */
export function chooseDockSide(
    anchor: DockAnchor,
    width: number,
    viewport: Viewport,
    keepClear: ReadonlyArray<Span> = []
): DockSide {
    if (anchor.kind === "preferred-left") return "left";
    const rightBand = {
        left: viewport.width - DOCK_EDGE_INSET - width,
        right: viewport.width,
    };
    if (anchor.kind === "elsewhere" && intersects(anchor.rect, rightBand))
        return "left";
    const leftBand = { left: 0, right: DOCK_EDGE_INSET + width };
    const relatedRight = keepClear.some((r) => intersects(r, rightBand));
    const relatedLeft = keepClear.some((r) => intersects(r, leftBand));
    return relatedRight && !relatedLeft ? "left" : "right";
}
