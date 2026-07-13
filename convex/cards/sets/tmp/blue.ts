// TMP — blue cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// Reprint-only entries: each CardPrint declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> the shared CardDefinition
// (ADR 0014).

import type { CardDefinition, CardPrint } from "../../types";

// Time Warp — {3}{U}{U} Sorcery. "Target player takes an extra turn after
// this one." (CR 500.7, Vintage Cube FREE tranche, issue #686.) DSL-first
// (ADR 0045): the `extraTurn` Op (mechanicsRegistry.ts) is a thin declarative
// skin over `SpellContext.takeExtraTurn` — the SAME primitive Time Walk's
// pre-DSL `resolve()` closure already calls (lea/blue.ts) — added as part of
// this card (no new engine capability, only the Op wrapper the primitive-reuse
// mandate calls for). `targetRequirement` is a single player (CR 601.2c);
// the announced slot feeds the Op's `player: { target: 0 }`.
export const timeWarp: CardDefinition = {
    id: "3447aeaf-3b26-442a-99d4-0a7ee76c8e76", // TMP 97
    rarity: "rare",
    name: "Time Warp",
    oracleText: "Target player takes an extra turn after this one.",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "extraTurn", player: { target: 0 } }],
};

// Counterspell — Premodern-legal reprint (Tempest, #980). Resolves to the LEA
// CardDefinition; the printId is the TMP per-print Scryfall UUID.
export const counterspellTmp: CardPrint = {
    printId: "dacdd380-71cf-4832-bd02-3697501325f3",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "tmp",
    rarity: "common",
};
