/**
 * SVG chart geometry (PRD #3148 S3), ported from `scripts/dashboard/svg.js`
 * (#2625).
 *
 * PURE — every function returns a value. What did NOT come across is `el()`,
 * the `createElementNS` helper: the vanilla charts built their nodes
 * imperatively because there was no render site, and React has one. A helper
 * that returns a detached DOM node would be a second way to draw, and the one
 * that cannot re-render.
 */

/**
 * A bar with a rounded TOP and square feet — the shape a stacked column wants:
 * only the topmost segment is rounded, everything under it must meet its
 * neighbour flat or the stack reads as separate bars.
 */
export function barPath(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): string {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}

/**
 * Axis ticks a person reads: steps of 1, 2, 2.5 or 5 times a power of ten,
 * never `max / 4` — an axis labelled `0 · 3,271 · 6,542` is arithmetically
 * correct and unreadable.
 */
export function niceTicks(max: number, count = 4): number[] {
    if (max <= 0) return [0];
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step =
        [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ??
        mag * 10;
    const out: number[] = [];
    // The `1.0001` slack is floating-point tolerance: a step that divides max
    // exactly can still land a hair above it and drop the top tick.
    for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
    return out;
}
