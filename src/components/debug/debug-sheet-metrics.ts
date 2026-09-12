/**
 * The debug sheet's DESKTOP geometry (issue #3493) — the one place the sheet's
 * width and the space the board gives up for it are written down.
 *
 * Two elements have to agree on one number: the sheet is `position: fixed`
 * (the shared sheet primitive anchors it to the viewport edge), so it takes no
 * space of its own, and the board area reserves that space with a margin. A
 * drift between the two is silent — a too-small margin puts the sheet back
 * over the board, a too-large one leaves a dead gutter — so neither call site
 * spells the number itself.
 *
 * They are CLASS LITERALS rather than an interpolated constant because
 * Tailwind scans source text: `w-[${WIDTH}px]` generates no CSS at all. The
 * numeric `DEBUG_SHEET_DESKTOP_WIDTH_PX` is what a test (and the `check:ui`
 * walk) measures against, and `__tests__/debug-sheet-push.test.tsx` asserts the
 * two literals actually carry it.
 */

/** The sheet's width at `lg` and wider. ~480px: the scenario form's per-seat
 *  pairs need two number inputs plus their labels on one line, which the
 *  primitive's `sm:max-w-sm` (384px) wraps. */
export const DEBUG_SHEET_DESKTOP_WIDTH_PX = 480;

/** Applied to the sheet's own popup. `lg:` only — below that the sheet keeps
 *  the overlay behaviour and its `w-[88%]` phone width. */
export const DEBUG_SHEET_DESKTOP_WIDTH_CLASS =
    "lg:w-[480px] lg:max-w-[480px]" as const;

/** Applied to the board area while the sheet is OPEN. A left MARGIN, not
 *  padding: the acceptance criterion is that the board's measured width
 *  shrinks, and padding leaves the element's own box the same size — the
 *  board area is the flex column's stretched child, so a margin is what takes
 *  the used width down by exactly the sheet's width. */
export const DEBUG_SHEET_PUSH_CLASS = "lg:ml-[480px]" as const;
