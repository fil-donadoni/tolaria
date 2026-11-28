// TDM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Ureni, the Song Unending — {5}{G}{U}{R} Legendary Creature — Spirit Dragon
// 10/10. Flying, protection from white and from black; its ETB divides X
// damage among opponents' creatures and planeswalkers, X = lands you control.
// CR 601.2d via CR 603.3d — the trigger announces the division as it is put on
// the stack, so the budget is the land count read at that moment
// (`divideAsChosen.total` as a text-defined quantity); each target gets ≥ 1.
// hand-tail: When {self} enters, it deals X damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control, where X is the number of lands you control. (#10543)
export const ureniTheSongUnending = defineCard(() => ({
    id: "227802c0-4ff6-43a8-a850-ed0f546dc5ac",
    rarity: "mythic",
    name: "Ureni, the Song Unending",
    oracleText:
        "Flying, protection from white and from black\nWhen Ureni enters, it deals X damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control, where X is the number of lands you control.",
    manaCost: { X: 5, G: 1, U: 1, R: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Spirit", "Dragon"],
    power: 10,
    toughness: 10,
    staticAbilities: [
        "flying",
        "protection from white",
        "protection from black",
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "ureni-etb",
            oracleText:
                "When Ureni enters, it deals X damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control, where X is the number of lands you control.",
            scope: "self",
            targetRequirement: {
                type: ["Creature", "Planeswalker"],
                count: { min: 1 },
                controller: "opponent",
                divideAsChosen: {
                    total: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                },
            },
            effects: [
                {
                    op: "dealDamageDividedAsChosen",
                    total: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                },
            ],
        }),
    ],
}));
