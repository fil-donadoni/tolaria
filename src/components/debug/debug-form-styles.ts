/** Design-system input at the compact size the debug forms use (`.input-field`
 *  carries the token colours/focus ring; the utilities only shrink it).
 *
 *  Shared, not copied: three debug form files had declared the identical string
 *  privately, which is one silent divergence away from three different-looking
 *  inputs in the same panel.
 *
 *  `py-1.5` rather than `py-1` since issue #3494: every control on the scenario
 *  surface was the same dense chip, and the vertical padding is the one number
 *  that buys the whole form a real target without changing any field's width
 *  inside a 293px-wide phone sheet. */
export const DEBUG_INPUT_CLASS = "input-field px-2 py-1.5 text-xs";
