// Edge auto-scroll geometry for the ordered drag strip (issue #9813). A large
// reorder (a mass mill into a graveyard, a big scry) overflows the viewport at
// the natural tile width, so the strip scrolls horizontally — and a drag must
// be able to reach a destination that is scrolled out of view without lifting
// the pointer. Holding the dragged card in a band near either edge of the
// visible strip scrolls it in that direction; this module is the pure
// pointer → velocity mapping, the frame loop lives in `useEdgeAutoScroll`.

/** Width (px) of the hot band inside each edge of the visible strip. */
export const EDGE_BAND_PX = 80;
/** Scroll speed (px/s) with the pointer AT (or past) the edge. */
export const EDGE_MAX_SPEED_PX_S = 1400;

/** Signed scroll velocity (px/s) for a pointer at `pointerX` over a visible
 *  strip spanning `[viewLeft, viewRight]` (all in the same coordinate space,
 *  e.g. client px). Zero outside both edge bands; negative (scroll left) in
 *  the left band, positive in the right one. The magnitude ramps
 *  quadratically from 0 at the band's inner boundary to `maxSpeed` at the
 *  edge, and stays capped at `maxSpeed` past it (a pointer dragged beyond the
 *  strip keeps scrolling at full speed). On a strip narrower than two bands
 *  each band shrinks to a quarter of the width so the two never overlap and
 *  the middle stays a still zone. */
export function edgeScrollVelocity(
    pointerX: number,
    viewLeft: number,
    viewRight: number,
    band: number = EDGE_BAND_PX,
    maxSpeed: number = EDGE_MAX_SPEED_PX_S
): number {
    const width = viewRight - viewLeft;
    if (width <= 0 || band <= 0 || maxSpeed <= 0) return 0;
    const b = Math.min(band, width / 4);
    const ramp = (dist: number) => {
        const depth = Math.min(1, Math.max(0, (b - dist) / b));
        return maxSpeed * depth * depth;
    };
    const fromLeft = pointerX - viewLeft;
    if (fromLeft < b) return -ramp(fromLeft);
    const fromRight = viewRight - pointerX;
    if (fromRight < b) return ramp(fromRight);
    return 0;
}
