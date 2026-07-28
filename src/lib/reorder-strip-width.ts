/**
 * Shared responsive tile-width fit for the two full-screen drag-reorder
 * strips (issue #1765) — `LibraryOrderPicker`'s scry/surveil/ponder/
 * distribute/putBack fan and `TriggerOrderPrompt`'s simultaneous-trigger
 * (CR 603.3b) ordering strip. Both lay out N tiles of a fixed NATURAL width
 * along one horizontal axis; on a narrow phone viewport (390px) a 5+ tile
 * strip at natural width overflows and tiles get cut off on the right. This
 * is the ONE fit computation both components call so the scaling rule lives
 * in a single place rather than two near-identical copies.
 *
 * The two strips' internal geometry differs (the library picker fuses a
 * library mock + up to two zones with several fixed gaps; the trigger prompt
 * is a flat `tileWidth + gap` sequence), but each strip's OWN total footprint
 * is always an AFFINE function of its tile width — `footprint(w) = m·w + b`
 * for constants `m`/`b` that depend on the fixed geometry and current card/
 * tile counts, never on `w` itself (every term in both layouts is either
 * `k · tileWidth` or a width-independent constant). That means the fit never
 * needs to know the caller's internal geometry: sampling the caller's own
 * `stripWidthAt(tileW)` at two distinct widths recovers the line, and solving
 * it for `availableWidth` gives the exact tile width that makes the strip fit
 * — no hardcoded natural pixel constants baked into this module.
 *
 * Below `minTileW` the strip stops shrinking (a floor for legibility of card
 * art / oracle text) and the caller's own horizontal scroll (`overflow-x-auto`)
 * takes over instead — the acceptance criteria's explicit fallback for a strip
 * that still cannot fit even at the readability floor.
 */
export function fitTileWidth(opts: {
    /** The strip's own total footprint (px) at a given tile width — e.g.
     *  `(w) => computeLayout(second.length, top.length, hasSecond, detached, detachRight, w).stripW`
     *  or `(w) => order.length * (w + GAP) - GAP`. Must be a pure function of
     *  `w` alone (same card/tile counts and chrome flags as the real render). */
    stripWidthAt: (tileW: number) => number;
    /** The tile width used when nothing needs to shrink (desktop default). */
    naturalTileW: number;
    /** Readability floor — the fit never returns less than this. */
    minTileW: number;
    /** Usable width (px) for the strip — the viewport minus any fixed
     *  surrounding chrome (modal padding, etc). */
    availableWidth: number;
}): number {
    const { stripWidthAt, naturalTileW, minTileW, availableWidth } = opts;

    // No real measurement (SSR, not-yet-mounted, or a degenerate 0/negative
    // width) → fall back to the natural size rather than guess.
    if (availableWidth <= 0) return naturalTileW;

    const naturalFootprint = stripWidthAt(naturalTileW);
    if (naturalFootprint <= availableWidth) return naturalTileW;

    const floorFootprint = stripWidthAt(minTileW);
    if (floorFootprint <= availableWidth) {
        // Two-point affine fit: footprint(w) = m·w + b, solved for the width
        // whose footprint equals `availableWidth`.
        const denom = naturalTileW - minTileW;
        if (denom === 0) return naturalTileW;
        const m = (naturalFootprint - floorFootprint) / denom;
        if (m <= 0) return naturalTileW;
        const b = naturalFootprint - m * naturalTileW;
        const fitted = (availableWidth - b) / m;
        return Math.min(naturalTileW, Math.max(minTileW, fitted));
    }

    // Even the floor overflows — stop shrinking; the caller's horizontal
    // scroll is the fallback (never render below the readability floor).
    return minTileW;
}

/** Fixed horizontal chrome shared by both full-screen strip modals: the
 *  overlay's own `p-6` (24px each side) plus the strip wrapper's `px-10`
 *  (40px each side). Both components subtract this from the raw viewport
 *  width before fitting tiles, so a viewport-width test can assert the exact
 *  same usable-width math the real modal renders with. */
export const MODAL_CHROME_PADDING_X = (24 + 40) * 2;
