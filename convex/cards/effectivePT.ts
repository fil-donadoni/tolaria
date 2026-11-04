// A card-side read of a permanent's effective power and toughness (CR 613.4).
// `cards/` cannot import the layer pipeline (it sits above this module in the
// import graph and the cycle breaks registry initialisation), so the dependency
// is inverted: `gre/layers.ts` registers its reader here.

import type { PermanentView, TriggerStateView } from "./types";

interface EffectivePT {
    readonly power: number;
    readonly toughness: number;
}

type EffectivePTReader = (
    self: PermanentView,
    state: TriggerStateView
) => EffectivePT;

let effectivePTReader: EffectivePTReader | null = null;

export function bindEffectivePTReader(reader: EffectivePTReader): void {
    effectivePTReader = reader;
}

export function readEffectivePT(
    self: PermanentView,
    state: TriggerStateView
): EffectivePT {
    // Unbound only where the layer pipeline was never loaded (a pure card
    // fixture): the printed values are then the only ones there are.
    return (
        effectivePTReader?.(self, state) ?? {
            power: self.power ?? 0,
            toughness: self.toughness ?? 0,
        }
    );
}
