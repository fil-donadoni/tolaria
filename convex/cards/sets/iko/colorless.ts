// Ikoria: Lair of Behemoths (IKO) — colorless cards.
//
// The five IKO "Triomes": non-basic triple-typed lands that enter tapped, tap
// for one of three colors, and have Cycling {3} (CR 702.29). All share the
// `makeTriome` factory (convex/cards/abilities/index.ts). Cycling is the
// engine/cost capability censused in the Mechanics Registry (issue #689).

import type { CardDefinition } from "../../types";
import { makeTriome } from "../../abilities";

export const raugrinTriome: CardDefinition = makeTriome({
    id: "c303a627-cce3-4045-81f8-fe7427e0a941",
    name: "Raugrin Triome",
    rarity: "rare",
    colors: ["U", "R", "W"],
});

export const indathaTriome: CardDefinition = makeTriome({
    id: "9bf2b208-79c6-4c4c-bf66-871352ed600f",
    name: "Indatha Triome",
    rarity: "rare",
    colors: ["W", "B", "G"],
});

export const savaiTriome: CardDefinition = makeTriome({
    id: "d21ef9e6-e2dd-4e0a-a36c-e07034ac4ba3",
    name: "Savai Triome",
    rarity: "rare",
    colors: ["R", "W", "B"],
});

export const ketriaTriome: CardDefinition = makeTriome({
    id: "f5b5b9bb-ee9f-4a52-bd74-fd2759c8e3d3",
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
