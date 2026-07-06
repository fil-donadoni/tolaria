// DSC — green cards, split by colour per ADR 0043. The registry's
// `import * as dsc from "./sets/dsc"` resolves through dsc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #684 stub — Ursine Monstrosity's combat trigger opens with
// "mill a card," which the issue's own live-vocabulary audit calls out as
// blocked: mill is `planned` backlog (part of `scryReorder`, per the issue
// body's "Audit each card..." note) with no engine event/primitive for
// moving a library card to the graveyard by count. The rest of the trigger
// (force-attack-a-random-opponent, indestructible + graveyard-card-type-
// counted pump) is downstream of the mill and Trample alone would
// misrepresent the card (gre-development.md "never ship partial"). Stop-
// and-issue; tracked stub.
// export const ursineMonstrosity: CardDefinition = {
//     id: "73cc6df4-3564-4ace-bf8a-eac3e62d725a",
//     name: "Ursine Monstrosity",
//     rarity: "rare",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Bear", "Mutant"],
//     power: 3,
//     toughness: 3,
// };

export {};
