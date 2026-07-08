// Shared geometry for the ordered top-of-library drag picker (scry / surveil /
// ponder). The smooth reorder reuses the HAND's mechanism — pointer capture +
// deferred commit (the dragged DOM node never moves mid-gesture) — NOT a dnd
// library, which is what makes it fluid.
export const CARD_W = 116;
export const CARD_H = Math.round(CARD_W * 1.4); // 5:7-ish, ≈162
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
