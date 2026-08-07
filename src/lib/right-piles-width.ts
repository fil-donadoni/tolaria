import {
    LANDSCAPE_PILE_SCALE,
    landscapeCardMetrics,
} from "~/lib/landscape-board-bands";
import { CONTROLLER_STRIP_CLEARANCE_EXPR } from "~/lib/controller-bar-metrics";

/** Horizontal band reserved on the right edge by the pile columns
 *  (graveyard/library/exile): right-3 (0.75rem) + 3 × --card-w-sm + 2 × gap-2
 *  (1rem). In portrait the piles collapse to bottom chips, so the band is 0.
 *  In landscape-compact (#1768) the piles are a ONE-tile-wide column docked
 *  beside the control strip, so what the play area loses on the right is the
 *  strip's own measured clearance PLUS that one pile-tile column
 *  ({@link LANDSCAPE_RIGHT_RAIL_VAR}, the board's own right inset) — omitting
 *  the tile term left a portal'd dialog centred ~half a tile off the true play
 *  area (#1770 follow-up from #1802).
 *  Single source of truth: set inline on `data-board-root` for in-subtree
 *  consumers (nameplate, hand) AND published to `document.documentElement`
 *  while the board is mounted so portal'd dialogs (rendered to body) can
 *  center on the play area instead of the full viewport. Two call sites need
 *  the same value — `Board` (documentElement) and `BoardSurface`
 *  (`data-board-root` inline style) — so this lives in a shared module rather
 *  than duplicated in either. */
export function rightPilesWidth(
    isPortrait: boolean,
    landscapeCompact: boolean,
    viewportHeight: number
): string {
    if (isPortrait) return "0px";
    if (landscapeCompact) {
        const pileWidth =
            landscapeCardMetrics(viewportHeight).cardWidth *
            LANDSCAPE_PILE_SCALE;
        return `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + ${pileWidth}px + 0.5rem)`;
    }
    return "calc(1.75rem + 3 * var(--card-w-sm))";
}
