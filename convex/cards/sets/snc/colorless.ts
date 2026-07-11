// Streets of New Capenna (SNC) — colorless cards.
//
// The five SNC "Triomes": non-basic triple-typed lands that enter tapped, tap
// for one of three colors, and have Cycling {3} (CR 702.29). All share the
// `makeTriome` factory (convex/cards/abilities/index.ts). Cycling is the
// engine/cost capability censused in the Mechanics Registry (issue #689).

import type { CardDefinition } from "../../types";
import { makeTriome } from "../../abilities";

export const jetmirsGarden: CardDefinition = makeTriome({
    id: "26d40e03-6de4-4373-9fbf-04c1dd79e995",
    name: "Jetmir's Garden",
    rarity: "rare",
    colors: ["R", "G", "W"],
});

export const xandersLounge: CardDefinition = makeTriome({
    id: "54f449ff-4025-465e-9ec5-a5cf42c4c9d3",
    name: "Xander's Lounge",
    rarity: "rare",
    colors: ["U", "B", "R"],
});

export const sparasHeadquarters: CardDefinition = makeTriome({
    id: "7363f1fb-9af3-4212-921f-d59533faf0e5",
    name: "Spara's Headquarters",
    rarity: "rare",
    colors: ["G", "W", "U"],
});

export const ziatorasProvingGround: CardDefinition = makeTriome({
    id: "75fdce80-e338-4a50-bdc6-786511feaeef",
    name: "Ziatora's Proving Ground",
    rarity: "rare",
    colors: ["B", "R", "G"],
});

export const raffinesTower: CardDefinition = makeTriome({
    id: "a2c56479-4bee-4edb-80d7-4af010b7c793",
    name: "Raffine's Tower",
    rarity: "rare",
    colors: ["W", "U", "B"],
});
