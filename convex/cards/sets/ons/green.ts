// ONS — green cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Enchantress's Presence — "Whenever you cast an enchantment spell, draw a
// card." (CR 603.2 + 601.2i spell-cast trigger; CR 121.1 draw.) A plain
// Enchantment with the enchantress draw trigger; the mandatory draw is a DSL
// Effect Script rather than a resolve() closure (ADR 0045).
export const enchantressPresence: CardDefinition = {
    id: "75def198-99d6-4b0a-8878-5151f44bc0a4",
    rarity: "rare",
    name: "Enchantress's Presence",
    oracleText: "Whenever you cast an enchantment spell, draw a card.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "enchantress-presence-draw",
            oracleText: "Whenever you cast an enchantment spell, draw a card.",
            scope: "you",
            filter: { types: "Enchantment" },
            // Mandatory draw, event-independent → DSL Effect Script (ADR 0045).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};
