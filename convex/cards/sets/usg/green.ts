// usg — green cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Argothian Enchantress — "Shroud. Whenever you cast an enchantment spell,
// draw a card." (CR 702.18 shroud; CR 603.2 + 601.2i spell-cast trigger; CR
// 121.1 draw.) The draw is mandatory (contrast the sibling Verduran
// Enchantress' optional "you may draw"), so its effect is a DSL Effect Script
// rather than a resolve() closure (ADR 0045).
//
// SHROUD GAP (CR 702.18): `shroud` is a registered keyword name but its status
// is `planned` — no target-legality check reads the `staticAbilities` string
// yet (same decorative class as the granted shroud on fem/blue.ts and
// jud/green.ts). The keyword is shipped on the printed definition for parity;
// the enchantress is not yet actually untargetable. Tracked by the registry.
export const argothianEnchantress: CardDefinition = {
    id: "9ababc1a-515e-4e20-8819-19d84d9b0af5",
    rarity: "rare",
    name: "Argothian Enchantress",
    oracleText:
        "Shroud (This creature can't be the target of spells or abilities.)\nWhenever you cast an enchantment spell, draw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 0,
    toughness: 1,
    staticAbilities: ["shroud"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "argothian-enchantress-draw",
            oracleText: "Whenever you cast an enchantment spell, draw a card.",
            scope: "you",
            filter: { types: "Enchantment" },
            // Mandatory draw, event-independent → DSL Effect Script (ADR 0045).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};

// Exploration — {G} Enchantment. "You may play an additional land on each of
// your turns." (CR 305.2 — extra land drops.) One additional land drop (total
// 2/turn), the bounded analogue of Fastbond's `extraLandDrops: 999`
// (lea/green.ts).
export const exploration: CardDefinition = {
    id: "2f09e451-0246-45a2-8bfd-07d3c65ddfe6",
    rarity: "rare",
    name: "Exploration",
    oracleText: "You may play an additional land on each of your turns.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    extraLandDrops: 1,
};
