// gpt (Guildpact) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

// import type { CardDefinition } from "../../types";

// The RAV/GPT/DIS "shock land" cycle — "(T: Add <c1> or <c2>.) As this land
// enters, you may pay 2 life. If you don't, it enters tapped."
// STOP-AND-ISSUE (tracked-by: #675): this is a genuine ETB CHOICE (pay life
// now for an untapped land vs. keep the life and accept tapped), not a
// deterministic board-state predicate — `entersTappedUnless` (built for this
// issue's fast lands / Arena of Glory / Starting Town shape) only supports a
// pure predicate over the board snapshot, with no player decision in the
// loop. Modelling the real choice needs a NEW suspend/resume point in the
// land-entry pipeline (`applyPlayLand` in `convex/gre/playLand.ts` currently
// returns synchronously with no pending-choice mechanism, unlike stack
// resolution's `resolveSteps`) plus the accompanying UI prompt and
// wire-format coverage — a capability cluster of its own, not a one-card
// fix. Left as a tracked stub pending that capability. Same rationale
// applies to every RAV/GPT/DIS shock land stubbed in this tranche.
// export const steamVents: CardDefinition = {
//     id: "054f2276-2dd5-43da-bb26-c57c560861fe",
//     name: "Steam Vents",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Island", "Mountain"],
// };
// export const stompingGround: CardDefinition = {
//     id: "a2773d8f-f906-475d-aaff-b7ca3b01f188",
//     name: "Stomping Ground",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Mountain", "Forest"],
// };
// export const godlessShrine: CardDefinition = {
//     id: "be010c2f-06db-47e3-80bd-df3f2a21ca34",
//     name: "Godless Shrine",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Plains", "Swamp"],
// };
export {};
