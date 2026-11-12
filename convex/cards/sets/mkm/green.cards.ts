// MKM — green cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Aftermath Analyst — {1}{G} Creature — Elf Detective, 1/3.
// "When this creature enters, mill three cards. {3}{G}, Sacrifice this
// creature: Return all land cards from your graveyard to the battlefield
// tapped." The ability is a mass reanimation: `forEach { set: "graveyard" }`
// with `simultaneous: true` hands the whole frozen land set to the entry
// funnel as ONE event (the Replenish shape, uds/white.cards.ts), so every
// land is staged before any landfall trigger looks at the battlefield. Each
// land enters tapped (CR 110.5b); cards return under their owner's control.
// hand-tail: {3}{G}, Sacrifice this creature: Return all land cards from your graveyard to the battlefield tapped. (#8605)
export const aftermathAnalyst = defineCard(() => ({
    id: "374e54d8-8e73-4268-9dde-c28c77bbbf32",
    rarity: "uncommon",
    name: "Aftermath Analyst",
    oracleText:
        "When this creature enters, mill three cards. (Put the top three cards of your library into your graveyard.)\n{3}{G}, Sacrifice this creature: Return all land cards from your graveyard to the battlefield tapped.",
    manaCost: { G: 1, X: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Detective"],
    power: 1,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "aftermath-analyst-etb",
            oracleText: "When this creature enters, mill three cards.",
            scope: "self",
            effects: [{ op: "mill", player: "controller", count: 3 }],
        }),
    ],
    activatedAbilities: [
        {
            id: "aftermath-analyst-return-lands",
            oracleText:
                "{3}{G}, Sacrifice this creature: Return all land cards from your graveyard to the battlefield tapped.",
            cost: { mana: { X: 3, G: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: "controller",
                        filter: { type: "Land" },
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "battlefield",
                            tapped: true,
                        },
                    ],
                },
            ],
        },
    ],
}));
