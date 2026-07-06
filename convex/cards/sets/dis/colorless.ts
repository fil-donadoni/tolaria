// dis (Dissension) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The RAV/GPT/DIS "shock land" cycle — "As this land enters, you may pay 2
// life. If you don't, it enters tapped." A stackless land-entry pay-choice
// (CR 614.12, ADR 0051), built by the shared `makeDualLand({ shockLand })`
// factory (see `convex/cards/sets/gpt/colorless.ts`).
export const breedingPool: CardDefinition = makeDualLand({
    id: "b98b2a35-ec2b-47fe-903d-dd292e469a3c",
    name: "Breeding Pool",
    rarity: "rare",
    colors: ["G", "U"],
    shockLand: true,
});

export const hallowedFountain: CardDefinition = makeDualLand({
    id: "c28aea19-2a39-4934-afda-909e234fa3ba",
    name: "Hallowed Fountain",
    rarity: "rare",
    colors: ["W", "U"],
    shockLand: true,
});

export const bloodCrypt: CardDefinition = makeDualLand({
    id: "f281e16f-0fe1-4095-bd63-0a4479f75c11",
    name: "Blood Crypt",
    rarity: "rare",
    colors: ["B", "R"],
    shockLand: true,
});
