// DOM reads for the hover preview dock side (issues #8955, #9500) — kept
// out of `card-preview-placement.ts`, whose decision stays pure.
import type { DockAnchor } from "~/lib/card-preview-placement";

/** Classify the hovered card's element for {@link chooseDockSide}: the
 *  board's `data-preview-dock-side` request wins, a battlefield permanent
 *  (`data-arrow-anchor-permanent` ancestor) is `battlefield`, anything else
 *  is `elsewhere` with its rect. */
export function dockAnchorOf(el: Element): DockAnchor {
    if (el.closest('[data-preview-dock-side="left"]'))
        return { kind: "preferred-left" };
    if (el.closest("[data-arrow-anchor-permanent]"))
        return { kind: "battlefield" };
    return { kind: "elsewhere", rect: el.getBoundingClientRect() };
}

/** The on-screen rects of the board nodes a hover highlight lit (issue
 *  #9500): permanents, players, stack items — by their arrow anchors —
 *  except the hovered card itself. */
export function litNodeRects(
    nodes: Iterable<string> | null | undefined,
    exceptEl?: Element | null
): DOMRect[] {
    if (!nodes) return [];
    const rects: DOMRect[] = [];
    for (const id of nodes) {
        const sel = ["permanent", "player", "stack"]
            .map((k) => `[data-arrow-anchor-${k}="${CSS.escape(id)}"]`)
            .join(",");
        for (const el of document.querySelectorAll(sel)) {
            // The hovered card itself (its anchor wraps it, or it wraps it).
            if (exceptEl && (el.contains(exceptEl) || exceptEl.contains(el)))
                continue;
            rects.push(el.getBoundingClientRect());
        }
    }
    return rects;
}
