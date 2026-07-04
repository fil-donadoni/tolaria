// kld (Kaladesh) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The KLD "fast land" cycle — see `makeDualLand`'s `fastLand` flag in
// `convex/cards/abilities/index.ts` for the shared conditional-tapped shape.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const inspiringVantage: CardDefinition = makeDualLand({
    id: "160ac412-005f-48ca-a204-10207307c6c2",
    name: "Inspiring Vantage",
    rarity: "rare",
    colors: ["R", "W"],
    fastLand: true,
});

export const spirebluffCanal: CardDefinition = makeDualLand({
    id: "4e587ea7-0632-4789-ba75-3c410da2bb96",
    name: "Spirebluff Canal",
    rarity: "rare",
    colors: ["U", "R"],
    fastLand: true,
});

export const botanicalSanctum: CardDefinition = makeDualLand({
    id: "8744471b-a528-47d9-84d0-4526273f55e9",
    name: "Botanical Sanctum",
    rarity: "rare",
    colors: ["G", "U"],
    fastLand: true,
});

export const bloomingMarsh: CardDefinition = makeDualLand({
    id: "90da33d4-fe9c-42fe-b326-2fe337dc3ecd",
    name: "Blooming Marsh",
    rarity: "rare",
    colors: ["B", "G"],
    fastLand: true,
});

export const concealedCourtyard: CardDefinition = makeDualLand({
    id: "c8769e97-aee8-4466-a9d7-0f4245ae4a97",
    name: "Concealed Courtyard",
    rarity: "rare",
    colors: ["W", "B"],
    fastLand: true,
});
