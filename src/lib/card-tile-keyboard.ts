import type { KeyboardEvent } from "react";

/**
 * Arrow-key navigation across a deckbuilder card grid (issue #2593, WCAG 2.2
 * AA / 2.1.1 keyboard).
 *
 * The deckbuilder's grid is not a `grid` in the CSS sense and it has no layout
 * a test can read: a Column (`[data-column]`, `deck-column-pile.tsx`) is a
 * VERTICAL overlaid pile of absolutely-positioned tiles, and the Columns
 * themselves lay out HORIZONTALLY in a snap strip. So the axes map to the DOM,
 * not to geometry:
 *
 * - `ArrowUp` / `ArrowDown` — previous / next tile inside the current Column.
 * - `ArrowLeft` / `ArrowRight` — the adjacent Column, same depth in the pile,
 *   clamped to that Column's last tile.
 * - `Home` / `End` — first / last tile of the current Column.
 *
 * Deriving it from DOM order rather than `getBoundingClientRect()` is not a
 * shortcut, it is the only option that is testable: happy-dom has no layout
 * engine, every rect is zeroes, and a geometric implementation would pass its
 * unit tests vacuously (`.claude/rules/chrome-debug.md`).
 *
 * Scoped to the nearest pane so an arrow press never jumps from the Maindeck
 * into the card source across the page — the panes are separate scroll ports
 * and separate tab stops.
 */

/**
 * Enter / Space activate a `role="button"` tile, which is what a native
 * `<button>` would have done for free.
 *
 * Shared because the repo grew TWO tiles carrying `role="button" tabIndex={0}`
 * with no `onKeyDown` — `deckbuilder/deck-card-tile.tsx` (every zone surface)
 * and `lobby/deck-builder/draggable-card.tsx` (the Constructed search results)
 * — and a second hand-written copy is how they would start disagreeing about
 * modifier chords or about events arriving from a descendant.
 *
 * Returns true when it activated, so a caller with further keys of its own
 * knows the event is spent.
 */
export function activateTileOnKey(
    event: KeyboardEvent<HTMLElement>,
    onActivate: () => void
): boolean {
    if (event.target !== event.currentTarget) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key !== "Enter" && event.key !== " ") return false;
    event.preventDefault();
    onActivate();
    return true;
}

/** Marks a focusable card tile. Set by `DeckCardTile`; the navigation reads
 *  nothing else, so any surface rendering that tile gets arrow keys for free. */
export const CARD_TILE_ATTR = "data-card-tile";

/** The pane / grid a run of arrow presses stays inside. `[data-deck-pane]` is
 *  the deckbuilder's own pane handle (source / maindeck / sideboard). */
const SCOPE_SELECTOR = "[data-card-grid],[data-deck-pane]";

const COLUMN_SELECTOR = "[data-column]";

export type TileNavKey =
    | "ArrowUp"
    | "ArrowDown"
    | "ArrowLeft"
    | "ArrowRight"
    | "Home"
    | "End";

const NAV_KEYS: readonly string[] = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
];

export function isTileNavKey(key: string): key is TileNavKey {
    return NAV_KEYS.includes(key);
}

/** The tiles of `scope`, grouped by their `[data-column]` ancestor in DOM
 *  order. A tile with no Column ancestor lands in one shared trailing group, so
 *  a flat surface still gets prev/next navigation. */
function columnsOf(scope: ParentNode): HTMLElement[][] {
    const tiles = [
        ...scope.querySelectorAll<HTMLElement>(`[${CARD_TILE_ATTR}]`),
    ];
    const groups = new Map<Element | null, HTMLElement[]>();
    for (const tile of tiles) {
        const column = tile.closest(COLUMN_SELECTOR);
        const list = groups.get(column);
        if (list) list.push(tile);
        else groups.set(column, [tile]);
    }
    return [...groups.values()];
}

/**
 * Move focus from `from` in the direction `key` names. Returns true when focus
 * actually moved — the caller only calls `preventDefault()` then, so an arrow
 * press at the edge of the grid still scrolls the pane.
 */
export function moveCardTileFocus(from: HTMLElement, key: TileNavKey): boolean {
    const scope = from.closest(SCOPE_SELECTOR) ?? from.ownerDocument;
    const columns = columnsOf(scope);
    if (columns.length === 0) return false;

    const col = columns.findIndex((tiles) => tiles.includes(from));
    if (col === -1) return false;
    const row = columns[col].indexOf(from);

    // One Column (or none at all): there is no second axis, so both axes
    // collapse onto previous/next in DOM order rather than doing nothing.
    const flat = columns.length === 1;

    let next: HTMLElement | undefined;
    switch (key) {
        case "ArrowUp":
            next = columns[col][row - 1];
            break;
        case "ArrowDown":
            next = columns[col][row + 1];
            break;
        case "ArrowLeft":
            next = flat
                ? columns[col][row - 1]
                : columns[col - 1]?.[
                      Math.min(row, (columns[col - 1]?.length ?? 1) - 1)
                  ];
            break;
        case "ArrowRight":
            next = flat
                ? columns[col][row + 1]
                : columns[col + 1]?.[
                      Math.min(row, (columns[col + 1]?.length ?? 1) - 1)
                  ];
            break;
        case "Home":
            next = columns[col][0];
            break;
        case "End":
            next = columns[col][columns[col].length - 1];
            break;
    }

    if (!next || next === from) return false;
    next.focus();
    // A tile lower in an overlaid pile shows only a sliver; bring the focused
    // one into its scroll port so the focus ring is never off-screen.
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
}
