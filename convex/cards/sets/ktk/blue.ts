// KTK — blue cards, split by colour per ADR 0043. The registry's
// `import * as ktk from "./sets/ktk"` resolves through ktk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Treasure Cruise — {7}{U} Sorcery. "Delve (Each card you exile from your
// graveyard while casting this spell pays for {1}.) Draw three cards."
// Issue #1336 (PRD #702, ADR 0063) — the first card to ship Delve (CR 702.66),
// the first consumer of the `payWith` cast-cost variant (CR 601.2g). Delve is
// COST-SYSTEM infrastructure, not an Effect Script Op: the keyword lives in
// `staticAbilities`, is read by `gre/payWith.ts` (`spellHasDelve`), and is paid
// through the generalized graveyard-exile picker in its variable-offset mode
// (`PendingCast.exileFromGraveyardChoice.offsetGeneric`) before `solveSmartAutoTap`
// covers the remainder. The card's own effect stays DSL — a single `draw` Op,
// already exercised catalogue-wide, so no hand-written per-card GRE test is
// required (the per-Op regime + the auto-generated smoke sweep cover it).
// Scryfall KTK #59.
export const treasureCruise: CardDefinition = {
    id: "7a59d4b1-6cf4-44ec-8a96-1bb7094fea21",
    name: "Treasure Cruise",
    rarity: "common",
    oracleText:
        "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nDraw three cards.",
    manaCost: { X: 7, U: 1 },
    types: ["Sorcery"],
    staticAbilities: ["delve"],
    effects: [{ op: "draw", player: "controller", count: 3 }],
};
