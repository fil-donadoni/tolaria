// dis (Dissension) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

// import type { CardDefinition } from "../../types";

// The RAV/GPT/DIS "shock land" cycle — see `convex/cards/sets/gpt/colorless.ts`
// for the full STOP-AND-ISSUE rationale (tracked-by: #675): the ETB "you may
// pay 2 life; if you don't, enters tapped" choice needs a suspend/resume
// point in `applyPlayLand` that doesn't exist yet — a capability cluster of
// its own. Left as tracked stubs pending that capability.
// export const breedingPool: CardDefinition = {
//     id: "b98b2a35-ec2b-47fe-903d-dd292e469a3c",
//     name: "Breeding Pool",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Forest", "Island"],
// };
// export const hallowedFountain: CardDefinition = {
//     id: "c28aea19-2a39-4934-afda-909e234fa3ba",
//     name: "Hallowed Fountain",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Plains", "Island"],
// };
// export const bloodCrypt: CardDefinition = {
//     id: "f281e16f-0fe1-4095-bd63-0a4479f75c11",
//     name: "Blood Crypt",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Swamp", "Mountain"],
// };
export {};
