// rav (Ravnica: City of Guilds) — colorless cards (ADR 0043 colour split).
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and
// colourless artifacts (no coloured cost) live here per the colour-split
// convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The RAV/GPT/DIS "shock land" cycle — "As this land enters, you may pay 2
// life. If you don't, it enters tapped." A stackless land-entry pay-choice
// (CR 614.12, ADR 0051), built by the shared `makeDualLand({ shockLand })`
// factory (see `convex/cards/sets/gpt/colorless.ts`).
export const wateryGrave: CardDefinition = makeDualLand({
    id: "139b90cd-8272-457a-be32-1298145345be",
    name: "Watery Grave",
    rarity: "rare",
    colors: ["U", "B"],
    shockLand: true,
});

export const sacredFoundry: CardDefinition = makeDualLand({
    id: "168ef687-5797-4b45-b75b-393d8117cebd",
    name: "Sacred Foundry",
    rarity: "rare",
    colors: ["R", "W"],
    shockLand: true,
});

export const templeGarden: CardDefinition = makeDualLand({
    id: "794a2b79-8c55-4423-8843-7e6e96f84071",
    name: "Temple Garden",
    rarity: "rare",
    colors: ["G", "W"],
    shockLand: true,
});

export const overgrownTomb: CardDefinition = makeDualLand({
    id: "fce07335-cc78-4683-b2f0-9c98a06ea1d8",
    name: "Overgrown Tomb",
    rarity: "rare",
    colors: ["B", "G"],
    shockLand: true,
});
