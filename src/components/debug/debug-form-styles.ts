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

/** The ONE checkbox style of the scenario form (issue #3512): spec-level flags
 *  rendered large and white while the card-row flags were small native dark
 *  boxes, so two controls with the same meaning looked like different kinds. */
export const DEBUG_CHECKBOX_CLASS = "size-4 shrink-0 accent-accent";

/**
 * The spec-field grid (issue #3512): labels in a flexible first column, values
 * in TWO fixed-width columns — the `me` and `opp` columns of a per-seat field.
 * Every section uses this same template inside the same container, so a
 * per-seat field's `me` input sits at one x whatever its label's length, which
 * the free-wrapping `flex-wrap` chips it replaced never could.
 *
 * `minmax(0,1fr)` rather than `1fr` so a long label wraps inside its cell
 * instead of pushing the value columns off a 293px phone sheet.
 */
export const DEBUG_FIELD_GRID_CLASS =
    "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-2 gap-y-1.5";

/** One input width per value kind (issue #3512), the SAME width as a value
 *  column above — so a number or a seat select is the same box in the grid and
 *  in a card row's flex line. The phase select (its step names are long) and
 *  the companion's name span BOTH value columns instead. Before this the phase
 *  select was several times wider than every other input. */
const VALUE_WIDTH = "w-[4.5rem] shrink-0";
export const DEBUG_NUMBER_INPUT_CLASS = `${DEBUG_INPUT_CLASS} ${VALUE_WIDTH}`;
export const DEBUG_SEAT_SELECT_CLASS = `${DEBUG_INPUT_CLASS} ${VALUE_WIDTH}`;
export const DEBUG_WIDE_VALUE_CLASS = "col-span-2 w-full min-w-0";
