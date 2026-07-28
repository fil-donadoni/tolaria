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

/** Tailwind's default `sm` breakpoint (40rem). Both full-screen strip
 *  modals' own responsive chrome classes (`p-2 sm:p-6` on the overlay,
 *  `px-0 sm:px-10` on the strip wrapper) and `modalChromePaddingX` below key
 *  off this SAME threshold — so the padding the browser actually renders and
 *  the number fed into `fitTileWidth`'s `availableWidth` can never drift
 *  apart. */
export const MOBILE_BREAKPOINT_PX = 640;

/** Modal overlay's own padding (`p-*`, one side), by breakpoint. */
const OVERLAY_PADDING_X = { mobile: 8, desktop: 24 } as const; // p-2 / p-6
/** Strip wrapper's own horizontal padding (`px-*`, one side), by breakpoint. */
const STRIP_WRAPPER_PADDING_X = { mobile: 0, desktop: 40 } as const; // px-0 / px-10

/** Total horizontal chrome (both sides combined) surrounding the strip at a
 *  given viewport width — review fix, issue #1765: a FIXED `(24 + 40) * 2`
 *  (desktop-shaped) constant left a 390px phone with only 262px usable,
 *  under what even a 2-card scry needs at the readability floor (`MIN_CARD_W`),
 *  making the responsive fit inert for every real scry. The overlay padding
 *  and the strip wrapper's own horizontal padding both shrink at the mobile
 *  breakpoint (`p-2 sm:p-6`, `px-0 sm:px-10`), and this function returns the
 *  EXACT same numbers those classes render with, so both full-screen pickers
 *  (`LibraryOrderPicker`, `TriggerOrderPrompt`) can derive `availableWidth`
 *  from the SAME source as the JSX rather than a separately-maintained
 *  constant. */
export function modalChromePaddingX(viewportW: number): number {
    const bucket = viewportW < MOBILE_BREAKPOINT_PX ? "mobile" : "desktop";
    return (OVERLAY_PADDING_X[bucket] + STRIP_WRAPPER_PADDING_X[bucket]) * 2;
}
