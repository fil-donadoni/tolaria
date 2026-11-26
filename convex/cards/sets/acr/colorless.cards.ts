// ACR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as acr from "./sets/acr/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live here.

import { defineCard, HISTORIC_FILTER } from "../../types";

// Abstergo Entertainment — Legendary Land (modern Tron, issue #10551).
//   - "{T}: Add {C}." / "{1}, {T}: Add one mana of any color." — CR 605.1a
//     mana abilities (`useStack: false`), the Talon Gates of Madara shape.
//   - "{3}, {T}, Exile Abstergo Entertainment: Return up to one target
//     historic card from your graveyard to your hand, then exile all
//     graveyards." — the `exileThis` cost (Feldon's Cane); "up to one" is
//     `count` min 0 (CR 601.2c). CR 700.6 "historic" (legendary, artifact,
//     or Saga) is the shared `HISTORIC_FILTER` union over a graveyard `card`
//     target. Body: `moveZone` the target to hand, then the Rest in Peace
//     whole-zone `moveZone` over both graveyards. A chosen target that is
//     illegal on resolution makes the whole ability not resolve (CR 608.2b),
//     so the graveyards survive; zero targets chosen still exiles them.
// hand-tail: {3}, {T}, Exile {self}: Return up to one target historic card from your graveyard to your hand, then exile all graveyards. (#10551)
export const abstergoEntertainment = defineCard(() => ({
    id: "4d197866-7633-493c-80dd-ec3a09165934", // ACR 79
    name: "Abstergo Entertainment",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{1}, {T}: Add one mana of any color.\n{3}, {T}, Exile Abstergo Entertainment: Return up to one target historic card from your graveyard to your hand, then exile all graveyards. (Artifacts, legendaries, and Sagas are historic.)",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "abstergo-entertainment-mana-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "abstergo-entertainment-mana-any",
            oracleText: "{1}, {T}: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
        {
            id: "abstergo-entertainment-recover",
            oracleText:
                "{3}, {T}, Exile Abstergo Entertainment: Return up to one target historic card from your graveyard to your hand, then exile all graveyards.",
            cost: { mana: { X: 3 }, tap: true, exileThis: true },
            useStack: true,
            targetRequirement: {
                type: "card",
                count: { min: 0, max: 1 },
                zone: "graveyard",
                controller: "you",
                typeOrSubtypeFilter: HISTORIC_FILTER,
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "hand" },
                {
                    op: "moveZone",
                    player: "controller",
                    fromZones: ["graveyard"],
                    filter: {},
                    to: "exile",
                },
                {
                    op: "moveZone",
                    player: "opponent",
                    fromZones: ["graveyard"],
                    filter: {},
                    to: "exile",
                },
            ],
        },
    ],
}));
