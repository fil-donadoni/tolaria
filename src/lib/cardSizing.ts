// Shared floor for the deckbuilder/draft card-size responsive clamp (issue
// #2056). Four sites independently held the same `min(rem, vw, dvh)` literal
// — a short-and-wide viewport (landscape phone, split-screen tablet, a short
// desktop window) makes the `dvh` term bind, collapsing the tile below
// legibility (measured 27.3 x 38.2px at 852x303, below the 44px iOS
// tap-target minimum). Floor lives in exactly ONE place so it can't drift
// back across the four call sites.

/** Smallest legible/tappable card width. Below this a card tile is an
 *  unreadable smudge and falls under the 44px iOS tap-target minimum.
 *  `4.5rem` (72px wide -> 100px tall at the 5:7 card aspect ratio) is the
 *  recommended floor from issue #2056, not a measured optimum — a single
 *  named constant so it can be tuned in one place. */
export const CARD_MIN_W = "4.5rem";

/** Builds the responsive card-width clamp used across the deckbuilder/draft
 *  surfaces: `max(CARD_MIN_W, min(rem, vw, dvh))`. The inner `min()` keeps
 *  the existing three responsive candidates (a fixed rem ceiling, a
 *  viewport-width share, a viewport-height share); the outer `max()` floors
 *  the result so the `dvh` term can never shrink the tile past
 *  `CARD_MIN_W`, no matter how short the viewport is. */
export function cardBase(rem: string, vw: string, dvh: string): string {
    return `max(${CARD_MIN_W}, min(${rem}, ${vw}, ${dvh}))`;
}

// --- Height-reachability math (issue #2275) -------------------------------
//
// `PoolDeckbuilderSurface` pins its own min-height to
// `calc(${cardBase("7.5rem", "17vw", "9dvh")} * 7 / 5 + 3.5rem)` (see
// `deck-builder-shell.tsx`) — CSS the browser resolves, but jsdom's
// CSSOM mangles a `calc()` nesting `min()`/`max()` on read-back (see
// `pool-deck-builder-form.test.tsx`), so a test that needs the actual NUMBER
// (not just the source-text expression) has no way to ask the DOM for it.
// This is a plain-TS mirror of that one expression, kept in the same file as
// the floor it derives from so the two can't drift apart silently. It does
// NOT change the floor (acceptance criterion, issue #2275) — it only lets a
// test compute the same number the CSS already produces.

const REM_PX = 16; // this app never overrides the root font-size (100%)
const CARD_MIN_W_PX = 4.5 * REM_PX; // 72 — mirrors CARD_MIN_W
const POOL_SURFACE_CARD_REM_CEILING_PX = 7.5 * REM_PX; // 120 — the surface's own "7.5rem" candidate

/**
 * Mirrors `PoolDeckbuilderSurface`'s `minHeight` in plain pixels for a given
 * viewport height. Ignores the clamp's `17vw` candidate — that term only
 * shrinks the result further on a NARROW viewport, so omitting it makes this
 * function return the least-favorable-for-reachability (largest) minimum for
 * a given height, never an underestimate, on any viewport at least ~706px
 * wide (`120 / 0.17`) — the short-and-wide class (landscape phone,
 * split-screen tablet, short desktop window) this issue and #2056 are both
 * about.
 *
 * Below 800px of viewport height (`0.09 * 800 === CARD_MIN_W_PX`) the `9dvh`
 * term is smaller than `CARD_MIN_W`, so the floor wins and the result is a
 * CONSTANT — 156.8px — independent of viewport height. Above 800px the
 * `9dvh` term takes over and the minimum grows with the viewport instead,
 * until it saturates at the `7.5rem` ceiling (120px core → 224px minHeight,
 * `120 * 7/5 + 56`) at 1333.3px of viewport height.
 */
export function poolSurfaceMinHeightPx(viewportHeightPx: number): number {
    const dvhTermPx = viewportHeightPx * 0.09; // 9dvh
    const cardBasePx = Math.max(
        CARD_MIN_W_PX,
        Math.min(POOL_SURFACE_CARD_REM_CEILING_PX, dvhTermPx)
    );
    return cardBasePx * (7 / 5) + 3.5 * REM_PX;
}
