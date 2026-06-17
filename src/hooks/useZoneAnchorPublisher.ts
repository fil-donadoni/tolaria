import { useEffect, type RefObject } from "react";
import type { Placement } from "~/lib/board-layout";
import type { SpatialItem } from "~/components/board/spatial-zone";
import { useArrowAnchors, type AnchorKind } from "~/hooks/arrowAnchorContext";

/** Marker attribute identifying the spatial board root — the coordinate space
 *  every published anchor point lives in. */
const BOARD_ROOT_SELECTOR = "[data-board-variant='next']";

type ZoneAnchorPublisherArgs = {
    /** Anchor bucket to publish under, or `undefined` to publish nothing
     *  (zones whose cards are never arrow targets, e.g. the hand). */
    kind: AnchorKind | undefined;
    /** The zone element — used to find its offset within the board root. */
    zoneRef: RefObject<HTMLElement | null>;
    items: SpatialItem[];
    /** Zone-local placements (already mirrored), 1:1 with `items`. */
    placements: Placement[];
    width: number;
    height: number;
};

/**
 * Publishes a spatial zone's per-item placement centers to the arrow-anchor
 * registry in **board-root coordinates** (PRD #249, slice #257).
 *
 * The card centers come from the shared layout `placements` (the single source
 * of truth that positions the cards); the only DOM read is the zone container's
 * static offset within the board root (`offsetLeft`/`offsetTop` of the zone box
 * relative to the board), which does not move as cards spring around. Adding the
 * two yields each card's board-coordinate center without ever sampling a moving
 * card element — so arrows stay glued through continuous motion.
 *
 * Re-runs whenever placements, size, or the item set change (the same triggers
 * that move the cards), and cleans up an item's anchor when it leaves the zone.
 */
export function useZoneAnchorPublisher({
    kind,
    zoneRef,
    items,
    placements,
    width,
    height,
}: ZoneAnchorPublisherArgs): void {
    const registry = useArrowAnchors();
    // `publish` / `unpublish` are stable (empty-dep useCallback in the
    // provider), so the effect re-runs on layout changes — not on every publish.
    const publish = registry?.publish;
    const unpublish = registry?.unpublish;

    useEffect(() => {
        if (!kind || !publish || !unpublish) return;
        const zone = zoneRef.current;
        if (!zone || width === 0 || height === 0) return;

        const offset = boardOffset(zone);
        const publishedIds: string[] = [];

        items.forEach((item, i) => {
            const p = placements[i];
            if (!p) return;
            publish(kind, item.key, {
                x: offset.x + p.x,
                y: offset.y + p.y,
            });
            publishedIds.push(item.key);
        });

        return () => {
            for (const id of publishedIds) unpublish(kind, id);
        };
        // Re-run when the layout inputs change (the same triggers that move the
        // cards); publish/unpublish are stable so they don't re-trigger.
    }, [kind, publish, unpublish, zoneRef, items, placements, width, height]);
}

/** Offset of `zone`'s top-left from the board root's top-left, in px. Walks the
 *  offset-parent chain up to (and excluding) the board root so the result is in
 *  board-root coordinates regardless of intermediate positioned wrappers. Falls
 *  back to `getBoundingClientRect` deltas if the root isn't an offset ancestor
 *  (e.g. transformed wrappers break the offsetParent chain). */
function boardOffset(zone: HTMLElement): { x: number; y: number } {
    const root = zone.closest<HTMLElement>(BOARD_ROOT_SELECTOR);
    if (!root) return { x: 0, y: 0 };

    // offsetParent chain is cheap and unaffected by CSS transforms on the cards
    // (the zone container itself is statically positioned within the board).
    let x = 0;
    let y = 0;
    let el: HTMLElement | null = zone;
    while (el && el !== root) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
    }
    if (el === root) return { x, y };

    // Fallback: the root was not in the offsetParent chain — measure directly.
    const zr = zone.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return { x: zr.left - rr.left, y: zr.top - rr.top };
}
