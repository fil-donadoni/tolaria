// 5DN (Fifth Dawn) — black cards, split by colour per ADR 0043. The registry's
// `import * as fifthDawn from "./sets/5dn"` resolves through 5dn/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Night's Whisper — "You draw two cards and lose 2 life." (CR 121.1 draw,
// CR 119.3 life loss.) Migrated resolve()→effects[] (ADR 0045, #1264): the
// DSL `draw` Op (issue #1250) is the suspend-capable seam, so an interactive
// draw replacement (Zur's Weirding) now offers its pay-2-life choice here too.
export const nightsWhisper: CardDefinition = {
    id: "61f0c6f6-b90d-4eb1-a5db-86e0a3997501",
    rarity: "uncommon",
    name: "Night's Whisper",
    oracleText: "You draw two cards and lose 2 life.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "draw", player: "controller", count: 2 },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};
