// MKM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm"` resolves through mkm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// The MKM "surveil land" cycle (CR 701.44) — a two-colour tapland that taps
// for one of two colours, enters tapped unconditionally, and surveils 1 on
// entry. All ten share one shape, driven by `makeDualLand({ surveilLand })`:
// basic land subtypes derived from the colours, `entersTapped: true`, the dual
// mana ability, and the self-ETB `scryReorder`/`graveyard` trigger (surveil =
// scry-into-graveyard, ADR 0045). Colour order matches the printed subtype
// order (`Land — <basic> <basic>`).
export const commercialDistrict: CardDefinition = makeDualLand({
    id: "bf220c06-3cce-4bdd-aa58-83940c223e9c",
    name: "Commercial District",
    rarity: "rare",
    colors: ["R", "G"],
    surveilLand: true,
});

export const elegantParlor: CardDefinition = makeDualLand({
    id: "72c6d541-e2cb-4d6e-acac-90a8f53b7006",
    name: "Elegant Parlor",
    rarity: "rare",
    colors: ["R", "W"],
    surveilLand: true,
});

export const hedgeMaze: CardDefinition = makeDualLand({
    id: "5260f8ae-805b-4eae-badf-62de0f768867",
    name: "Hedge Maze",
    rarity: "rare",
    colors: ["G", "U"],
    surveilLand: true,
});

export const lushPortico: CardDefinition = makeDualLand({
    id: "c17816e8-28b1-4295-a637-efb0e5c18873",
    name: "Lush Portico",
    rarity: "rare",
    colors: ["G", "W"],
    surveilLand: true,
});

export const meticulousArchive: CardDefinition = makeDualLand({
    id: "652236c2-84ef-45e4-b5fc-ed6170bc3d6c",
    name: "Meticulous Archive",
    rarity: "rare",
    colors: ["W", "U"],
    surveilLand: true,
});

export const raucousTheater: CardDefinition = makeDualLand({
    id: "b598c93e-dae1-4d71-a9e4-917abf76d2d0",
    name: "Raucous Theater",
    rarity: "rare",
    colors: ["B", "R"],
    surveilLand: true,
});

export const shadowyBackstreet: CardDefinition = makeDualLand({
    id: "69c1b656-1d67-499c-bf0f-417682a86c7d",
    name: "Shadowy Backstreet",
    rarity: "rare",
    colors: ["W", "B"],
    surveilLand: true,
});

export const thunderingFalls: CardDefinition = makeDualLand({
    id: "17260fff-b239-4af4-9306-3236ae3fa5a5",
    name: "Thundering Falls",
    rarity: "rare",
    colors: ["U", "R"],
    surveilLand: true,
});

export const undercitySewers: CardDefinition = makeDualLand({
    id: "2b5801fb-2026-4f25-98bc-ebb2f99684b9",
    name: "Undercity Sewers",
    rarity: "rare",
    colors: ["U", "B"],
    surveilLand: true,
});

export const undergroundMortuary: CardDefinition = makeDualLand({
    id: "f6ca59cd-8779-4a84-a54b-e863b79c61f0",
    name: "Underground Mortuary",
    rarity: "rare",
    colors: ["B", "G"],
    surveilLand: true,
});
