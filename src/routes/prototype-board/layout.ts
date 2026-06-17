/**
 * PROTOTYPE — shared layout math (identical for DOM + WebGL so the comparison
 * is about RENDERING, not positioning). Throwaway — delete after decision.
 */

export type Placed = { x: number; y: number; rot: number; scale: number };

/** Auto-sizing row: cards keep full size until they overflow the width, then
 *  they overlap (step shrinks). Centered horizontally at cy. */
export function rowLayout(
    n: number,
    width: number,
    cardW: number,
    cy: number,
    gap = 12
): Placed[] {
    if (n === 0) return [];
    const ideal = cardW + gap;
    const maxStep = n > 1 ? (width - cardW) / (n - 1) : 0;
    const step = Math.min(ideal, Math.max(maxStep, cardW * 0.32));
    const totalW = cardW + step * (n - 1);
    const startX = (width - totalW) / 2 + cardW / 2;
    // Shrink scale only when even heavy overlap can't fit (very high counts).
    const naturalW = cardW + cardW * 0.32 * (n - 1);
    const scale = naturalW > width ? Math.max(0.7, width / naturalW) : 1;
    return Array.from({ length: n }, (_, i) => ({
        x: startX + step * i,
        y: cy,
        rot: 0,
        scale,
    }));
}

/** Fan: cards along a shallow arc, rotated toward the edges. */
export function fanLayout(
    n: number,
    width: number,
    cardW: number,
    baseY: number,
    cardH: number
): Placed[] {
    if (n === 0) return [];
    const spreadMax = 44; // total degrees
    const degPer = n > 1 ? Math.min(spreadMax / (n - 1), 7) : 0;
    const step = Math.min(cardW * 0.62, (width - cardW) / Math.max(1, n - 1));
    const totalW = cardW + step * (n - 1);
    const startX = (width - totalW) / 2 + cardW / 2;
    const mid = (n - 1) / 2;
    return Array.from({ length: n }, (_, i) => {
        const off = i - mid;
        const rot = off * degPer;
        const lift = Math.abs(off) * (cardH * 0.04);
        return { x: startX + step * i, y: baseY + lift, rot, scale: 1 };
    });
}

export const CARD_W = 120;
export const CARD_H = Math.round((CARD_W * 7) / 5);
