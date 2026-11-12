// PROTOTYPE (zone-target highlight) — the arrows currently drawn, so the hover
// focus can hit-test them (owner feedback 2026-11-12: hovering the ARROW must
// focus its relationship too). Same model as the real layer (issue #5853): the
// arrow layer stays pointer-events:none, a passive proximity test decides.
import type { CurveGeo, Pt } from "./use-zone-target-model";

export type HitArrow = { geo: CurveGeo; groups: string[] };

let current: HitArrow[] = [];

export function publishArrows(arrows: HitArrow[]) {
    current = arrows;
}

const RADIUS = 9;
const SEGMENTS = 24;

function distToSeg(p: Pt, a: Pt, b: Pt) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
    );
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function at({ a, c, b }: CurveGeo, t: number): Pt {
    const u = 1 - t;
    return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
}

/** Group keys of the nearest arrow within reach of `p`, or null. */
export function hitTestArrows(p: Pt): string[] | null {
    let best: HitArrow | null = null;
    let bestD = RADIUS;
    for (const arrow of current) {
        let prev = arrow.geo.a;
        for (let i = 1; i <= SEGMENTS; i++) {
            const next = at(arrow.geo, i / SEGMENTS);
            const d = distToSeg(p, prev, next);
            if (d < bestD) {
                bestD = d;
                best = arrow;
            }
            prev = next;
        }
    }
    return best ? best.groups : null;
}
