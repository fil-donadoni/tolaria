import type { ViewportRect } from "~/lib/visible-rect";

/** Selectors of the DOM elements a lit highlight node may render as (issue
 *  #9326): a stack row, a permanent, a player nameplate, a zone pile. Node ids
 *  are opaque — an activated ability's stack item even shares its source
 *  permanent's id — so every node is looked up under every anchor kind; a
 *  miss costs nothing. A zone pile's node id is `<zone>-pile:<ownerId>`
 *  (`zonePileNodeId`). */
export function focusNodeSelectors(nodeId: string): string[] {
    const pile = /^(graveyard|exile)-pile:(.+)$/.exec(nodeId);
    if (pile) {
        return [`[data-arrow-anchor-${pile[1]}="${cssString(pile[2])}"]`];
    }
    const id = cssString(nodeId);
    return [
        `[data-arrow-anchor-stack="${id}"]`,
        `[data-arrow-anchor-permanent="${id}"]`,
        `[data-arrow-anchor-player="${id}"]`,
    ];
}

/** Escape a value for a double-quoted CSS attribute selector. */
function cssString(v: string): string {
    return v.replace(/["\\]/g, "\\$&");
}

/** Padding around each focus hole (px). */
const HOLE_PAD = 4;
/** Corner radius of each focus hole (px). */
const HOLE_RADIUS = 8;

/** A rounded rectangle traced COUNTER-clockwise: against the clockwise outer
 *  rectangle the nonzero rule cuts it out of the veil. */
function holePath(r: ViewportRect): string {
    const x = r.left - HOLE_PAD;
    const y = r.top - HOLE_PAD;
    const w = r.width + HOLE_PAD * 2;
    const h = r.height + HOLE_PAD * 2;
    const k = Math.min(HOLE_RADIUS, w / 2, h / 2);
    return `M ${x + k} ${y} A ${k} ${k} 0 0 0 ${x} ${y + k} V ${y + h - k} A ${k} ${k} 0 0 0 ${x + k} ${y + h} H ${x + w - k} A ${k} ${k} 0 0 0 ${x + w} ${y + h - k} V ${y + k} A ${k} ${k} 0 0 0 ${x + w - k} ${y} Z`;
}

/** Merge holes whose padded boxes overlap into their bounding box: under the
 *  nonzero rule two overlapping counter-clockwise holes wind to -1 where they
 *  meet and the veil fills that patch back in (the same box twice — a spell's
 *  row is its source AND, under a counterspell, a target — would vanish
 *  entirely). */
function mergeHoles(holes: readonly ViewportRect[]): ViewportRect[] {
    const out = holes.map((r) => ({ ...r }));
    const overlaps = (a: ViewportRect, b: ViewportRect) =>
        a.left - HOLE_PAD < b.left + b.width + HOLE_PAD &&
        b.left - HOLE_PAD < a.left + a.width + HOLE_PAD &&
        a.top - HOLE_PAD < b.top + b.height + HOLE_PAD &&
        b.top - HOLE_PAD < a.top + a.height + HOLE_PAD;
    for (let merged = true; merged; ) {
        merged = false;
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                if (!overlaps(out[i], out[j])) continue;
                const a = out[i];
                const b = out[j];
                const left = Math.min(a.left, b.left);
                const top = Math.min(a.top, b.top);
                out[i] = {
                    left,
                    top,
                    width: Math.max(a.left + a.width, b.left + b.width) - left,
                    height: Math.max(a.top + a.height, b.top + b.height) - top,
                };
                out.splice(j, 1);
                merged = true;
                break outer;
            }
        }
    }
    return out;
}

/** The veil's clip path: the whole viewport (clockwise) minus one hole per lit
 *  element. */
export function veilClipPath(
    holes: readonly ViewportRect[],
    width: number,
    height: number
): string {
    const cut = mergeHoles(holes).map(holePath).join(" ");
    return `M 0 0 H ${width} V ${height} H 0 Z ${cut}`.trim();
}
