// Streets of New Capenna (SNC) — colorless cards.
//
// The five SNC "Triomes": non-basic triple-typed lands that enter tapped, tap
// for one of three colors, and have Cycling {3} (CR 702.29). All share the
// `makeTriome` factory (convex/cards/abilities/index.ts). Cycling is the
// engine/cost capability censused in the Mechanics Registry (issue #689).

import type { CardDefinition } from "../../types";
import { makeTriome } from "../../abilities";

export const jetmirsGarden: CardDefinition = makeTriome({
    id: "ca9203fa-12db-4fa0-affd-4db277c871b7",
    name: "Jetmir's Garden",
    rarity: "rare",
    colors: ["R", "G", "W"],
});

export const xandersLounge: CardDefinition = makeTriome({
    id: "1d96f496-1fc1-4e66-878a-b0905e920cdc",
    name: "Xander's Lounge",
    rarity: "rare",
    colors: ["U", "B", "R"],
});

export const sparasHeadquarters: CardDefinition = makeTriome({
    id: "0ddd6093-eb29-4a1a-a0af-debb86c9cadd",
    name: "Spara's Headquarters",
    rarity: "rare",
    colors: ["G", "W", "U"],
});

export const ziatorasProvingGround: CardDefinition = makeTriome({
    id: "307c4a30-a859-487c-b72d-f10eebcd01c4",
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
