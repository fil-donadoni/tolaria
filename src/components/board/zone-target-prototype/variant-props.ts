// PROTOTYPE (zone-target highlight) — shared variant props + geometry re-exports.
import type { Anchors, Rect, ZoneTargetGroup } from "./use-zone-target-model";

export {
    center,
    curve,
    inward,
    zoneClusters,
    zoneWord,
} from "./use-zone-target-model";

export type VariantProps = {
    groups: ZoneTargetGroup[];
    anchors: Record<string, Anchors>;
    /** Measured `[data-proto-measure]` rects, keyed by attribute value. */
    extra: Record<string, Rect>;
    /** Hovered relationship (group keys), null = nothing hovered. */
    focus: Set<string> | null;
};

/** Outside the hovered relationship? (never dim when nothing is hovered) */
export function isDim(focus: Set<string> | null, keys: string[]): boolean {
    return !!focus && !keys.some((k) => focus.has(k));
}

export function isLit(focus: Set<string> | null, keys: string[]): boolean {
    return !!focus && keys.some((k) => focus.has(k));
}
