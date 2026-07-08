// TOR (Torment) — red cards, split by colour per ADR 0043. The registry's
// `import * as tor from "./sets/tor"` resolves through tor/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Grim Lavamancer — {R} 1/1 Creature — Human Wizard (Torment, Premodern-legal;
// issue #987, parent PRD #979). "{R}, {T}, Exile two cards from your graveyard:
// This creature deals 2 damage to any target." (CR 605 activated ability; CR
// 602.1 / 118.5 / 406 exile-from-graveyard activation cost restricted to the
// activator's OWN graveyard via `owner: "you"`; CR 120.1 / 115.4 "any target"
// damage.) Pure DSL: the cost is declarative and the effect is a single
// `dealDamage` Op — no closure needed.
export const grimLavamancer: CardDefinition = {
    id: "5dd72697-24be-42c7-a6d9-a837bdbd4662",
    name: "Grim Lavamancer",
    rarity: "rare",
    oracleText:
        "{R}, {T}, Exile two cards from your graveyard: This creature deals 2 damage to any target.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "grim-lavamancer-bolt",
            oracleText:
                "{R}, {T}, Exile two cards from your graveyard: Grim Lavamancer deals 2 damage to any target.",
            cost: {
                mana: { R: 1 },
                tap: true,
                exileFromGraveyard: { count: 2, owner: "you" },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
