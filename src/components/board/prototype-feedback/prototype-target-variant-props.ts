// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=`).
import type { PrototypeTargetTracking } from "./use-prototype-target-tracking";

export type PrototypeTargetVariantProps = PrototypeTargetTracking & {
    kind: "attack" | "spell";
};

export const PROTOTYPE_TARGET_SVG_CLASS =
    "absolute inset-0 h-full w-full overflow-visible";
