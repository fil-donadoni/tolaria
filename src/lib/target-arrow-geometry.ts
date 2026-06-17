/**
 * Pure geometry for the spatial board's SVG target arrows (PRD #249, slice
 * #257). Maps a set of board-coordinate anchor points + the current stack to
 * the endpoints (and curved SVG path) of each target arrow.
 *
 * DOM-free and side-effect-free: every function here is a pure mapping from
 * `(stack, anchors)` → arrow specs, unit-testable without a renderer. The anchor
 * points are derived from the SAME shared layout placements that position the
 * cards (`board-layout.ts`, surfaced by the arrow-anchor registry, #251/#257),
 * so the arrows recompute from the single source of truth and never reverse-
 * engineer positions by sampling the moving DOM at an instant.
 */

import type { StackItem } from "~/types/game";

/** A resolved anchor point in board-root coordinates (px). Both endpoints of
 *  every arrow come from this — published by zones from layout placements and by
 *  the player/pile edge anchors. */
export type AnchorPoint = {
    x: number;
    y: number;
};

/** Lookup of every anchor id → its board-coordinate point. Mirrors the
 *  `data-arrow-anchor-*` key space: stack ids, permanent ids, player ids,
 *  graveyard-owner ids. */
export type AnchorMap = {
    /** Stack-item ids (source of every arrow; also `spell` targets). */
    stack: Record<string, AnchorPoint>;
    /** Permanent (battlefield card) instance ids. */
    permanent: Record<string, AnchorPoint>;
    /** Player ids. */
    player: Record<string, AnchorPoint>;
    /** Graveyard owner (player) ids. */
    graveyard: Record<string, AnchorPoint>;
};

/** One resolved arrow: a stable key, both endpoints, and a precomputed curved
 *  SVG path string connecting them. */
export type TargetArrow = {
    key: string;
    /** Source (stack item) center. */
    from: AnchorPoint;
    /** Target center. */
    to: AnchorPoint;
    /** Quadratic-bezier `d` attribute from `from` to `to`. */
    path: string;
};

/** Empty registry — convenient default before any zone has published. */
export function emptyAnchorMap(): AnchorMap {
    return { stack: {}, permanent: {}, player: {}, graveyard: {} };
}

/** Resolve one stack target to its anchor point, or `null` if no anchor exists
 *  for it yet (zone not measured, owner unknown, etc.). Exhaustive over the
 *  `StackItem["targets"][n].type` union (CR target categories). */
function resolveTarget(
    target: NonNullable<StackItem["targets"]>[number],
    anchors: AnchorMap
): AnchorPoint | null {
    switch (target.type) {
        case "permanent":
            return anchors.permanent[target.id] ?? null;
        case "player":
            return anchors.player[target.id] ?? null;
        case "spell":
            return anchors.stack[target.id] ?? null;
        case "graveyard-card":
            return target.playerId
                ? (anchors.graveyard[target.playerId] ?? null)
                : null;
        default: {
            // Exhaustiveness guard: a new target type must be handled here.
            const _exhaustive: never = target.type;
            return _exhaustive;
        }
    }
}

/**
 * Build the arrow set for the current stack from resolved anchor points.
 *
 * One arrow per `(stack item → target)` pair. A pair is skipped when either
 * endpoint has no anchor yet (the registry hasn't published it), so partially
 * laid-out boards never draw an arrow into the origin. Arrow keys are stable
 * across renders so React reconciles rather than remounts as placements move.
 */
export function buildTargetArrows(
    stack: StackItem[],
    anchors: AnchorMap
): TargetArrow[] {
    const arrows: TargetArrow[] = [];
    for (const item of stack) {
        if (!item.targets || item.targets.length === 0) continue;
        const from = anchors.stack[item.id];
        if (!from) continue;
        for (const target of item.targets) {
            const to = resolveTarget(target, anchors);
            if (!to) continue;
            arrows.push({
                key: `${item.id}->${target.type}:${target.id}:${
                    target.playerId ?? ""
                }`,
                from,
                to,
                path: arrowPath(from, to),
            });
        }
    }
    return arrows;
}

/** Curvature of the arrow as a fraction of the chord length: the control point
 *  is offset perpendicular to the chord by this × |chord|. Gives the "fluid"
 *  bowed look the leader-line arrows had, recomputed analytically each frame. */
const ARROW_BOW_FRACTION = 0.18;

/**
 * Quadratic-bezier path from `from` to `to`, bowed perpendicular to the chord
 * so overlapping arrows separate visually. Pure function of the two endpoints —
 * recomputed every time a placement changes, which is what keeps the arrow
 * glued to a continuously-animating card with no DOM sampling.
 */
export function arrowPath(from: AnchorPoint, to: AnchorPoint): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    if (len === 0) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    // Perpendicular unit vector (-dy, dx) / len, scaled by the bow distance.
    const bow = len * ARROW_BOW_FRACTION;
    const cx = mx + (-dy / len) * bow;
    const cy = my + (dx / len) * bow;
    return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}
