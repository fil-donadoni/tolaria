// Leaf-level mana colour constants (CR 105.1 / 305.6), split out of
// `gre/constants.ts` to break an import cycle: `gre/constants.ts` needs
// `gre/layers.ts` (issue #927 — `getEffectivePower`/`getEffectiveToughness`
// for board-conditional mana abilities), and `gre/layers.ts` already needs
// `cards/colors.ts` (`getColorsFromCost`, CR 613.1d layer 5), which in turn
// read these two constants off `gre/constants.ts` — a cycle that breaks
// module init (`MANA_COLORS` reads as `undefined` inside `colors.ts` at
// import time). Moving the constants to this dependency-free leaf severs the
// cycle; `gre/constants.ts` re-exports both so every existing
// `from "../gre/constants"` import site is unaffected.
import type { Color } from "../cards/types";

/** All six mana colors in canonical order. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Intrinsic mana abilities for basic land subtypes (CR 305.6). */
export const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};
