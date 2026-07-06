// gpt (Guildpact) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The RAV/GPT/DIS "shock land" cycle — "As this land enters, you may pay 2
// life. If you don't, it enters tapped. ({T}: Add <c1> or <c2>.)". The
// land-entry pay-choice is a stackless PendingChoice suspended by
// `applyPlayLand` (CR 614.12, ADR 0051); the shared `makeDualLand({ shockLand })`
// factory carries the basic land subtypes, the dual mana ability, and the
// `entersTappedUnlessPay: { life: 2 }` clause.
export const steamVents: CardDefinition = makeDualLand({
    id: "054f2276-2dd5-43da-bb26-c57c560861fe",
    name: "Steam Vents",
    rarity: "rare",
    colors: ["U", "R"],
    shockLand: true,
});

export const stompingGround: CardDefinition = makeDualLand({
    id: "a2773d8f-f906-475d-aaff-b7ca3b01f188",
    name: "Stomping Ground",
    rarity: "rare",
    colors: ["R", "G"],
    shockLand: true,
});

export const godlessShrine: CardDefinition = makeDualLand({
    id: "be010c2f-06db-47e3-80bd-df3f2a21ca34",
    name: "Godless Shrine",
    rarity: "rare",
    colors: ["W", "B"],
    shockLand: true,
});
