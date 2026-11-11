/**
 * Desktop Booster SIZE modes (issue #9166, player feedback 2026-11): three
 * named intents instead of an unlabelled slider — `fit` (the whole pack on
 * screen, no scrolling), `large` (bigger cards, the grid scrolls; the
 * default) and `read` (one row at the size where oracle text is legible).
 *
 * Pure, because the numbers ARE the specification. The one rule that needs
 * pinning down is the `fit` CEILING: with 2 cards left, "the biggest layout
 * that fits" is a pair of poster-sized cards; `fit` never renders a card
 * wider than the `read` size, so `read` is always the largest a card gets
 * outside a hover.
 */

export type DraftPackSizeMode = "fit" | "large" | "read";

/** What the pack grid is told to draw on desktop. `large` carries no numbers:
 *  the grid keeps its `auto-fill` track driven by the persisted zoom. */
export type DraftPackSizing =
    | { mode: "large" }
    | { mode: "read"; cardWidth: number }
    | { mode: "fit"; columns: number; cardWidth: number };

export const DRAFT_PACK_SIZE_MODES: readonly {
    mode: DraftPackSizeMode;
    label: string;
    hint: string;
}[] = [
    { mode: "fit", label: "Fit all", hint: "Whole pack, no scrolling" },
    { mode: "large", label: "Large", hint: "Bigger cards, grid scrolls" },
    { mode: "read", label: "Read", hint: "One row, largest cards" },
];

export const DEFAULT_DRAFT_PACK_SIZE_MODE: DraftPackSizeMode = "large";

/** Gap between pack tiles, px (Tailwind `gap-3`, the desktop grid's gap). */
export const DRAFT_PACK_GAP_PX = 12;

const READ_MIN_W = 224;
const READ_MAX_W = 352;
const READ_VIEWPORT_SHARE = 0.24;
/** Card aspect ratio (width / height). */
const CARD_ASPECT = 5 / 7;

/** The `read` card width: 24% of the viewport, between 224px and 352px. Also
 *  the `fit` ceiling. */
export function readCardWidth(viewportWidth: number): number {
    return Math.round(
        Math.min(
            READ_MAX_W,
            Math.max(READ_MIN_W, viewportWidth * READ_VIEWPORT_SHARE)
        )
    );
}

export interface FitLayout {
    columns: number;
    /** Rendered card width, px — never above the ceiling. */
    cardWidth: number;
}

/**
 * The layout that shows `count` cards in `width` x `height` with the largest
 * cards, none wider than `ceiling`. Among layouts that reach the same
 * (possibly ceiling-capped) width the one with FEWER ROWS wins, so a few
 * cards sit in one row rather than a column.
 */
export function fitAllLayout({
    count,
    width,
    height,
    ceiling,
    gap = DRAFT_PACK_GAP_PX,
}: {
    count: number;
    width: number;
    height: number;
    ceiling: number;
    gap?: number;
}): FitLayout {
    if (count <= 0) return { columns: 1, cardWidth: ceiling };
    let best: FitLayout = { columns: 1, cardWidth: 0 };
    for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const byWidth = (width - gap * (columns - 1)) / columns;
        const byHeight = ((height - gap * (rows - 1)) / rows) * CARD_ASPECT;
        const cardWidth = Math.floor(
            Math.max(0, Math.min(byWidth, byHeight, ceiling))
        );
        // `>=`: columns ascend, so on a tie the later (more columns, fewer
        // rows) layout wins.
        if (cardWidth >= best.cardWidth) best = { columns, cardWidth };
    }
    return best;
}
