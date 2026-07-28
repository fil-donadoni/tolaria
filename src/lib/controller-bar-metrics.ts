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
