// Shared geometry for the ordered top-of-library drag picker (scry / surveil /
// ponder). The smooth reorder reuses the HAND's mechanism — pointer capture +
// deferred commit (the dragged DOM node never moves mid-gesture) — NOT a dnd
// library, which is what makes it fluid.
export const CARD_W = 116;
export const CARD_H = Math.round(CARD_W * 1.4); // 5:7-ish, ≈162
/** Responsive readability floor (issue #1765) — the picker shrinks its tile
 *  width down to fit a narrow phone viewport (`fitTileWidth`,
 *  `~/lib/reorder-strip-width`), but never below this. Below it the strip's
 *  own horizontal scroll takes over instead of shrinking further. */
export const MIN_CARD_W = 72;
/** 5:7-ish card aspect ratio, applied to whatever tile width the fit picks —
 *  the same ratio `CARD_H` uses at the natural size. */
export function cardHeightFor(cardW: number): number {
    return Math.round(cardW * 1.4);
}
/** Visible width per overlapped card in a zone fan (overlap = CARD_W − REVEAL). */
export const REVEAL = 60;
/** Small gap fusing a zone onto the library (scry/ponder continuous fan). */
export const GAP_FUSED = 14;
/** Bigger gap around a DETACHED zone (surveil graveyard, its own dashed box). */
export const GAP_DETACHED = 44;
/** How much the top fan tucks UNDER the library's right edge (Arena fuse). */
export const LIB_OVERLAP = 24;
/** Vertical hover-lift of the card under the pointer while dragging. */
export const LIFT = 12;
/** Pointer travel (px) before a press becomes a drag — mirrors the hand's
 *  DRAG_START_PX so both gestures have the same activation feel. */
export const DRAG_START_PX = 6;

/** Deck mock geometry (`deck-mock.tsx`) — kept here, not in the component
 *  file, so `deckWidthFor` (a plain helper, not a component) doesn't trip
 *  `react-refresh/only-export-components` on a file whose default export is
 *  a component. */
export const DECK_BACKS = 4;
/** px each card-back peeks to the right of the one behind it. */
export const DECK_STEP = 16;

/** Deck mock footprint at a given (possibly responsive, issue #1765) card
 *  width. `layout.ts` and the picker call this directly to compute strip
 *  geometry without mounting React. */
export function deckWidthFor(cardW: number): number {
    return cardW + DECK_STEP * (DECK_BACKS - 1);
}
