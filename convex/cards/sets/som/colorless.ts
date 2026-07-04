// som (Scars of Mirrodin) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The SOM "fast land" cycle — see `makeDualLand`'s `fastLand` flag in
// `convex/cards/abilities/index.ts` for the shared conditional-tapped shape.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const copperlineGorge: CardDefinition = makeDualLand({
    id: "28f1d784-f286-418d-a712-bc07ad10d4a2",
    name: "Copperline Gorge",
    rarity: "rare",
    colors: ["R", "G"],
    fastLand: true,
});

export const razorvergeThicket: CardDefinition = makeDualLand({
    id: "345e053a-3178-485c-8602-1624bbf2f064",
    name: "Razorverge Thicket",
    rarity: "rare",
    colors: ["G", "W"],
    fastLand: true,
});

export const blackcleaveCliffs: CardDefinition = makeDualLand({
    id: "3d71be5f-0fd7-4a88-8041-f4d6bc4cc9ac",
    name: "Blackcleave Cliffs",
    rarity: "rare",
    colors: ["B", "R"],
    fastLand: true,
});

export const seachromeCoast: CardDefinition = makeDualLand({
    id: "99939b90-e88c-4c2f-ba78-56d455611703",
    name: "Seachrome Coast",
    rarity: "rare",
    colors: ["W", "U"],
    fastLand: true,
});

export const darkslickShores: CardDefinition = makeDualLand({
    id: "e530388b-eb19-4211-abd8-8a4c3c38c3af",
    name: "Darkslick Shores",
    rarity: "rare",
    colors: ["U", "B"],
    fastLand: true,
});

// Mox Opal — "Metalcraft — {T}: Add one mana of any color. Activate only if
// you control three or more artifacts." STOP-AND-ISSUE (tracked-by: #675):
// Metalcraft is entirely absent from `convex/cards/mechanicsRegistry.ts` (not
// even `planned`) — an uncensused mechanic is a stop-and-issue case. Separately,
// even with Metalcraft censused, `canActivate` (the board-state activation
// gate) is checked only on the generic `activateAbility` / `activateManaAbility`
// mutations — the tap-mana fast path (`tapUntap`) that a `{T}`-only mana
// ability like this one actually goes through never consults `canActivate` at
// all, so the gate wouldn't even be enforced without also wiring that check
// into `tapUntap`. Left as a tracked stub pending both.
// export const moxOpal: CardDefinition = {
//     id: "6be9b1d5-9ab8-4adb-ba54-2c0117e842fa",
//     name: "Mox Opal",
//     rarity: "mythic",
//     types: ["Artifact"],
// };
