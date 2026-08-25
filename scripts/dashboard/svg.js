/**
 * SVG chart primitives shared by the History charts (#2625). Pure: every
 * function returns a value or a detached node, none of them reads the page.
 */

const NS = "http://www.w3.org/2000/svg";

export const el = (n, a = {}) => {
    const e = document.createElementNS(NS, n);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    return e;
};

/** Rounded top on the topmost segment only; flat where it stacks. */
export function barPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}

export function niceTicks(max, count = 4) {
    if (max <= 0) return [0];
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step =
        [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ??
        mag * 10;
    const out = [];
    for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
    return out;
}
