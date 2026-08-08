// Manual verb popover anchors (issue #2170) — resolves the DOM element an
// anchored popover positions against, from the STABLE data attributes the
// board already stamps on every pile tile (`data-zone-drop`/`data-zone-owner`,
// `player-library.tsx` / `player-graveyard.tsx` / `player-exile.tsx`) and
// every battlefield permanent (`data-arrow-anchor-permanent`, shared with the
// target-arrow anchor registry, `battlefield-card.tsx` /
// `board-battlefield-card.tsx`).
//
// A ONE-TIME synchronous `document.querySelector` read at verb-selection
// time, never a live subscription — deliberately DOM-touching (like the
// `window.prompt`/`window.confirm` calls this issue replaces), so it stays
// out of the "pure" `manual-runtime.ts` aggregator. It resolves correctly
// even though the context menu item / touch action-sheet row that dispatched
// the click has already started to unmount by the time the popover positions
// itself: the pile tile and the permanent's own element are never removed,
// only the transient menu around them is.

import type { PileZone } from "~/hooks/usePileActionsContext";

/** `CSS.escape` isn't guaranteed present in every test environment; this
 *  covers the characters a Convex-generated id could plausibly carry without
 *  depending on the browser API. */
function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return value.replace(/["\\\]]/g, "\\$&");
}

/** Resolves a CSS selector to the live anchor element, or `null` when nothing
 *  matches. */
export function findManualAnchor(selector: string): Element | null {
    return document.querySelector(selector);
}

/** Selector for one battlefield permanent's own element — the same anchor the
 *  target-arrow registry uses. */
export function permanentAnchorSelector(instanceId: string): string {
    return `[data-arrow-anchor-permanent="${cssEscape(instanceId)}"]`;
}

/** Selector for one player's pile tile (library / graveyard / exile). */
export function pileAnchorSelector(zone: PileZone, ownerId: string): string {
    return `[data-zone-drop="${zone}"][data-zone-owner="${cssEscape(ownerId)}"]`;
}

/** Selector for the board root (`manual-board-view.tsx`'s `<main
 *  data-manual-board>`) — the fallback anchor for a verb with no natural
 *  card/pile referent (Concede: `manual-controller-actions.ts`). The
 *  controller's own action buttons render through THREE separate layout
 *  components (pod / bottom bar / landscape strip) with no shared anchor
 *  attribute of their own, so anchoring to the always-mounted board root
 *  avoids threading a new data attribute through all three just for one
 *  verb. */
export const BOARD_ANCHOR_SELECTOR = "[data-manual-board]";
