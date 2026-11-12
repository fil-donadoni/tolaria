// PROTOTYPE (zone-target highlight) — shared variant props + geometry re-exports.
import type { Anchors, ZoneTargetGroup } from "./use-zone-target-model";

export { curve, inward } from "./use-zone-target-model";

export type VariantProps = {
    groups: ZoneTargetGroup[];
    anchors: Record<string, Anchors>;
    /** Simulated scenario: the real arrow layer has nothing to draw, so the
     *  variant draws the stack → pile arrow itself. */
    drawBase: boolean;
};

export function zoneWord(z: ZoneTargetGroup["zone"]) {
    return z === "graveyard" ? "graveyard" : "exile";
}
