// Ikoria: Lair of Behemoths (IKO) — colorless cards.
//
// The five IKO "Triomes": non-basic triple-typed lands that enter tapped, tap
// for one of three colors, and have Cycling {3} (CR 702.29). All share the
// `makeTriome` factory (convex/cards/abilities/index.ts). Cycling is the
// engine/cost capability censused in the Mechanics Registry (issue #689).

import type { CardDefinition } from "../../types";
import { makeTriome } from "../../abilities";

export const raugrinTriome: CardDefinition = makeTriome({
    id: "02138fbb-3962-4348-8d31-faaefba0b8b2",
    name: "Raugrin Triome",
    rarity: "rare",
    colors: ["U", "R", "W"],
});

export const indathaTriome: CardDefinition = makeTriome({
    id: "2b74bb81-fb9a-40e5-a941-e517430b52f5",
    name: "Indatha Triome",
    rarity: "rare",
    colors: ["W", "B", "G"],
});

export const savaiTriome: CardDefinition = makeTriome({
    id: "748e6a61-9c1f-4225-9f04-e54002f63ac3",
    name: "Savai Triome",
    rarity: "rare",
    colors: ["R", "W", "B"],
});

export const ketriaTriome: CardDefinition = makeTriome({
    id: "a249b1f4-2b22-4b67-a207-e0c4ae95d2e1",
    name: "Ketria Triome",
    rarity: "rare",
    colors: ["G", "U", "R"],
});

export const zagothTriome: CardDefinition = makeTriome({
    id: "cc520518-2063-4b57-a0d4-10cf62a7175e",
    name: "Zagoth Triome",
    rarity: "rare",
    colors: ["B", "G", "U"],
});
