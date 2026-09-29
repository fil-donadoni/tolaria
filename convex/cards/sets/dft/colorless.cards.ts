// dft (Aetherdrift) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeVergeLand } from "../../abilities";

// The DFT "Verge" cycle — see `makeVergeLand` in
// `convex/cards/abilities/index.ts` for the shared board-conditional
// second-ability shape. Vintage Cube free tranche (issue #675, ADR 0041).
export const riverpyreVerge: CardDefinition = makeVergeLand({
    id: "57a93a71-d77c-417f-85d0-cd420f573331",
    name: "Riverpyre Verge",
    rarity: "rare",
    primary: "R",
    secondary: "U",
    unlockedBy: ["Island", "Mountain"],
});

export const bleachboneVerge: CardDefinition = makeVergeLand({
    id: "52dcdabd-a186-45fe-9fee-6c0f1afeaf16",
    name: "Bleachbone Verge",
    rarity: "rare",
    primary: "B",
    secondary: "W",
    unlockedBy: ["Plains", "Swamp"],
});

export const wastewoodVerge: CardDefinition = makeVergeLand({
    id: "5ceacc7d-d407-4f82-af58-9bdf8426924e",
    name: "Wastewood Verge",
    rarity: "rare",
    primary: "G",
    secondary: "B",
    unlockedBy: ["Swamp", "Forest"],
});
