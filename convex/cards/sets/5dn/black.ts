// 5DN (Fifth Dawn) — black cards, split by colour per ADR 0043. The registry's
// `import * as fifthDawn from "./sets/5dn"` resolves through 5dn/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, SpellContext } from "../../types";

// Night's Whisper — "You draw two cards and lose 2 life." (CR 121.1 draw,
// CR 119.3 life loss.) Pure composition of the `drawCards` + `loseLife`
// primitives.
export const nightsWhisper: CardDefinition = {
    id: "61f0c6f6-b90d-4eb1-a5db-86e0a3997501",
    rarity: "uncommon",
    name: "Night's Whisper",
    oracleText: "You draw two cards and lose 2 life.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.drawCards(ctx.controller, 2);
        ctx.loseLife(ctx.controller, 2);
    },
};
