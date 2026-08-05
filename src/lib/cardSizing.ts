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
