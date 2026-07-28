/** Geometry contract between the portrait bottom bar (#1759) and everything
 *  that must stay clear of it.
 *
 *  The bar is `fixed` at the bottom edge with `z-40`, and its command row
 *  WRAPS: a one-line bar is ~106px, but a wide DECLARE_ATTACKERS board pushes
 *  the side pills onto their own line and the bar grows to ~150px. A consumer
 *  that reserves a HARD-CODED inset (the old `bottom-32`, 128px) is therefore
 *  correct only for the one-line bar — the grown bar covered the bottom of the
 *  portrait hand strip (eating taps on it) and overlapped the Zones drawer's
 *  own fixed edge.
 *
 *  So the bar publishes its MEASURED height instead, and consumers anchor to
 *  that. {@link useControllerBarHeight} writes the variable; the class below is
 *  the single spelling of "sit just above the bar" every consumer uses. */

/** CSS custom property carrying the bar's measured height, in px. Published on
 *  `document.documentElement` (the consumers are `fixed` elements living in
 *  unrelated subtrees, so the document root is the only shared ancestor) and
 *  removed when the bar unmounts. */
export const CONTROLLER_BAR_HEIGHT_VAR = "--controller-bar-h";

/** Pins a `fixed` element just above the portrait bottom bar, whatever height
 *  the bar currently has. The `8rem` fallback is the old fixed reservation —
 *  it applies only when no bar is mounted (landscape, lobby), where nothing is
 *  overlapped anyway. */
export const ABOVE_CONTROLLER_BAR =
    "bottom-[calc(var(--controller-bar-h,8rem)+0.5rem)]";

/** The SAME clearance as a parenthesised CSS sum expression, so it composes
 *  inside a larger `calc()` (`calc(<EXPR> + …)`, `calc(50% - <EXPR> / 2)`)
 *  instead of only being spellable as a whole class. The portrait band budget
 *  (`portrait-board-bands.ts`) folds it into its own arithmetic: the bands sit
 *  ABOVE the hand, which itself sits above the bar, so the bar's measured
 *  height propagates all the way up the board.
 *
 *  The two spellings are pinned together by
 *  `src/lib/__tests__/portrait-board-bands.test.ts` — `ABOVE_CONTROLLER_BAR`
 *  must stay `bottom-[calc<EXPR>]` with whitespace removed, so neither can
 *  drift from the other. */
export const CONTROLLER_BAR_CLEARANCE_EXPR =
    "(var(--controller-bar-h, 8rem) + 0.5rem)";

/** The SAME contract, rotated 90°, for the landscape-compact control strip
 *  (#1769). Landscape phones are wide but VERY short, so that mode docks its
 *  controls to the RIGHT EDGE rather than the bottom one — height is the scarce
 *  dimension there, and a bottom bar would spend it. What neighbours must
 *  reserve is therefore a WIDTH.
 *
 *  CSS custom property carrying the strip's measured width, in px. Published on
 *  `document.documentElement` by {@link useControllerStripWidth} and removed
 *  when the strip unmounts — which is what lets a single anchor class serve
 *  both the desktop pod branch (no strip → variable absent → fallback) and the
 *  landscape branch, with no consumer branching on the viewport mode itself. */
export const CONTROLLER_STRIP_WIDTH_VAR = "--controller-strip-w";

/** Anchors a right-edge `fixed` element just LEFT of the landscape-compact
 *  strip, whatever width the strip currently has.
 *
 *  The `0px` fallback is load-bearing, not defensive: with no strip mounted
 *  (desktop, portrait) this evaluates to `calc(0px + 0.75rem)` = 12px, i.e.
 *  exactly the `right-3` the phase panel has always used — so the desktop pod's
 *  phase panel keeps its pixel position while the landscape panel slides clear
 *  of the strip automatically. */
export const BESIDE_CONTROLLER_STRIP =
    "right-[calc(var(--controller-strip-w,0px)+0.75rem)]";

/** The SAME clearance as a parenthesised CSS sum expression, so it composes
 *  inside a larger `calc()` instead of only being spellable as a whole class —
 *  the lateral twin of {@link CONTROLLER_BAR_CLEARANCE_EXPR}. The landscape
 *  band budget (`landscape-board-bands.ts`, #1768) folds it into its own
 *  arithmetic: the pile column sits beside the strip and the board's bands stop
 *  before BOTH, so the strip's measured width propagates all the way across the
 *  board.
 *
 *  The two spellings are pinned together by
 *  `src/lib/__tests__/landscape-board-bands.test.ts` —
 *  {@link BESIDE_CONTROLLER_STRIP} must stay `right-[calc<EXPR>]` with
 *  whitespace removed, so neither can drift from the other. */
export const CONTROLLER_STRIP_CLEARANCE_EXPR =
    "(var(--controller-strip-w, 0px) + 0.75rem)";
