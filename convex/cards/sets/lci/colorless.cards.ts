// LCI — colorless cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";

// Echoing Deeps — Land — Cave (LCI). "You may have this land enter tapped as a
// copy of any land card in a graveyard" is the declarative as-enters copy
// (CR 614.1c / 707.5) drawn from every graveyard (`fromGraveyard`), optional by
// construction; `entersTappedAsCopy` taps it only when a card is chosen, so
// declining leaves the printed untapped Cave. "Except it's a Cave in addition
// to its other types" is CR 707.9b's `additionalSubtypes`.
// hand-tail: You may have this land enter tapped as a copy of any land card in a graveyard, except it's a Cave in addition to its other types. (#8614)
export const echoingDeeps = defineCard(() => ({
    id: "244c06b3-532d-426e-8bee-ee9461d092a6",
    name: "Echoing Deeps",
    rarity: "rare",
    oracleText:
        "You may have this land enter tapped as a copy of any land card in a graveyard, except it's a Cave in addition to its other types.\n{T}: Add {C}.",
    manaCost: {},
    types: ["Land"],
    subtypes: ["Cave"],
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                fromGraveyard: { type: "Land" },
                entersTappedAsCopy: true,
                opts: { additionalSubtypes: ["Cave"] },
            },
        ],
    },
    activatedAbilities: [
        {
            id: "echoing-deeps-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effects: [{ op: "addMana", mana: { C: 1 } }],
            manaProduced: { C: 1 },
        },
    ],
}));
