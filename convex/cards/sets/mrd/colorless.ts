// mrd (Mirrodin) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeTalisman } from "../../abilities";

// Talisman of Progress / Dominance — {2} artifact mana rocks (Vintage Cube
// free tranche, issue #675, ADR 0041). See `makeTalisman` in
// `convex/cards/abilities/index.ts` for the shared painland-shaped ability.
export const talismanOfProgress: CardDefinition = makeTalisman({
    id: "41ff849e-2439-4690-8aa4-769039b6da4c",
    name: "Talisman of Progress",
    rarity: "uncommon",
    colors: ["W", "U"],
});

export const talismanOfDominance: CardDefinition = makeTalisman({
    id: "991037a2-fea2-49f5-8ace-ebbf9f678cff",
    name: "Talisman of Dominance",
    rarity: "uncommon",
    colors: ["U", "B"],
});
