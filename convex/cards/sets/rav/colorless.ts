// rav (Ravnica: City of Guilds) — colorless cards (ADR 0043 colour split).
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and
// colourless artifacts (no coloured cost) live here per the colour-split
// convention.

// import type { CardDefinition } from "../../types";

// The RAV/GPT/DIS "shock land" cycle — see `convex/cards/sets/gpt/colorless.ts`
// for the full STOP-AND-ISSUE rationale (tracked-by: #675): the ETB "you may
// pay 2 life; if you don't, enters tapped" choice needs a suspend/resume
// point in `applyPlayLand` that doesn't exist yet — a capability cluster of
// its own. Left as tracked stubs pending that capability.
// export const wateryGrave: CardDefinition = {
//     id: "139b90cd-8272-457a-be32-1298145345be",
//     name: "Watery Grave",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Island", "Swamp"],
// };
// export const sacredFoundry: CardDefinition = {
//     id: "168ef687-5797-4b45-b75b-393d8117cebd",
//     name: "Sacred Foundry",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Mountain", "Plains"],
// };
// export const templeGarden: CardDefinition = {
//     id: "794a2b79-8c55-4423-8843-7e6e96f84071",
//     name: "Temple Garden",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Forest", "Plains"],
// };
// export const overgrownTomb: CardDefinition = {
//     id: "fce07335-cc78-4683-b2f0-9c98a06ea1d8",
//     name: "Overgrown Tomb",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Swamp", "Forest"],
// };
export {};
