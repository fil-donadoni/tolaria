/** Design-system input at the compact size the debug forms use (`.input-field`
 *  carries the token colours/focus ring; the utilities only shrink it).
 *
 *  Shared, not copied: three debug form files had declared the identical string
 *  privately, which is one silent divergence away from three different-looking
 *  inputs in the same panel. */
export const DEBUG_INPUT_CLASS = "input-field px-2 py-1 text-xs";
