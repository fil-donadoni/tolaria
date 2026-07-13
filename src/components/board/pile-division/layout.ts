// Geometry for the pile-division stage (Fact or Fiction). Three zones stacked
// vertically — a full-width CANDIDATES row on top, two half-width PILE boxes
// below — with cards laid out absolutely so a drag only mutates one card's
// transform (the scry picker's stable-node trick). All coordinates are
// stage-local px; the picker positions zone backgrounds and cards from the same
// constants so the drop hit-test lines up with what the player sees.
import type { CardInstance } from "~/types/game";

export type PileKey = "candidates" | "A" | "B";

export const CARD_W = 104;
export const CARD_H = Math.round(CARD_W * 1.4); // ≈146
export const STAGE_W = 560;

/** Gap between adjacent cards when a zone has room to spread them out. */
const GAP = 10;
/** Vertical y of the top edge of the cards in each row. */
const CANDIDATES_CARD_Y = 20;
const PILE_CARD_Y = 210;
/** Half-gutter between the two pile boxes. */
const HALF_GUTTER = 10;
const PILE_W = STAGE_W / 2 - HALF_GUTTER;

export type ZoneBox = {
    left: number;
    top: number;
    width: number;
    height: number;
};

/** The three drop-zone background rectangles (also the hit-test targets). */
export const ZONE_BOXES: Record<PileKey, ZoneBox> = {
    candidates: { left: 0, top: 0, width: STAGE_W, height: 170 },
    A: { left: 0, top: 186, width: PILE_W, height: 174 },
    B: {
        left: STAGE_W / 2 + HALF_GUTTER,
        top: 186,
        width: PILE_W,
        height: 174,
    },
};

const CARD_Y: Record<PileKey, number> = {
    candidates: CANDIDATES_CARD_Y,
    A: PILE_CARD_Y,
    B: PILE_CARD_Y,
};

/** Fans `n` cards horizontally inside a box: spread with `GAP` when they fit,
 *  else overlap evenly so the whole row stays inside the box. Returns the left
 *  x of each card slot. */
function fanX(box: ZoneBox, n: number): number[] {
    if (n === 0) return [];
    const availW = box.width - 16;
    const spread = n * CARD_W + (n - 1) * GAP;
    if (n === 1) return [box.left + (box.width - CARD_W) / 2];
    if (spread <= availW) {
        const start = box.left + (box.width - spread) / 2;
        return Array.from({ length: n }, (_, i) => start + i * (CARD_W + GAP));
    }
    const step = (availW - CARD_W) / (n - 1);
    const start = box.left + 8;
    return Array.from({ length: n }, (_, i) => start + i * step);
}

/** Position map (instanceId → stage-local top-left) for every card, grouped by
 *  its current zone assignment and fanned within that zone. `isPick` is unused
 *  by the maths (the assignment already reflects the A/B split) but kept for
 *  call-site symmetry with the picker. */
export function computePileLayout(
    cards: CardInstance[],
    assignment: Record<string, PileKey>,
    _isPick: boolean
): Map<string, { x: number; y: number }> {
    void _isPick; // kept for call-site symmetry with the picker; unused by the maths
    const groups: Record<PileKey, CardInstance[]> = {
        candidates: [],
        A: [],
        B: [],
    };
    for (const c of cards) groups[assignment[c.id] ?? "candidates"].push(c);

    const out = new Map<string, { x: number; y: number }>();
    for (const key of ["candidates", "A", "B"] as PileKey[]) {
        const xs = fanX(ZONE_BOXES[key], groups[key].length);
        groups[key].forEach((c, i) => {
            out.set(c.id, { x: xs[i], y: CARD_Y[key] });
        });
    }
    return out;
}
