/** Right-hand padding a route's bottom band reserves at `md` and up, so its
 *  right-most action is never under the router-root floating bug-report
 *  trigger (`bug-report-floating-button.tsx`, issue #7148). The trigger sits
 *  `md:right-4` in the corner on a `size="icon"` plate: 2rem on a fine
 *  pointer, floored to `--touch-min` (44px) on a coarse one (issue #2792).
 *  Clearance = that inset + that plate + a 0.5rem gap. Below `md` the trigger
 *  rides 8.5rem up, clear of any bottom band, so nothing is owed. */
export const FLOATING_TRIGGER_CLEARANCE =
    "md:pr-[calc(1rem+max(2rem,var(--touch-min))+0.5rem)]";
