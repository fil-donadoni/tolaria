// mh2 — green cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Ignoble Hierarch — {G} Creature — Goblin Shaman, 0/1. "Exalted (CR 702.83) —
// Whenever a creature you control attacks alone, that creature gets +1/+1
// until end of turn.\n{T}: Add {B}, {R}, or {G}." The Jund-colours cousin of
// Noble Hierarch (Vintage Cube mana dork, issue #699). Same shape as Noble
// Hierarch: the exalted keyword expands to its triggered ability at the
// `getDefinition` seam, and the CHOICE mana ability is a CR 605.1a mana
// ability (useStack: false) via `manaChoices`.
export const ignobleHierarch: CardDefinition = {
    id: "aba51852-af8f-49d8-8fb6-22d52a1742b8",
    rarity: "rare",
    name: "Ignoble Hierarch",
    oracleText:
        "Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\n{T}: Add {B}, {R}, or {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Shaman"],
    power: 0,
    toughness: 1,
    staticAbilities: ["exalted"],
    activatedAbilities: [
        {
            id: "ignoble-hierarch-mana",
            oracleText: "{T}: Add {B}, {R}, or {G}.",
            cost: { tap: true },
            effect: (ctx) => {
                ctx.addMana({ G: 1 });
            },
            useStack: false,
            manaChoices: [{ B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// TODO(issue #900 stub — Evoke itself SHIPPED (#900: `CardDefinition.evoke` +
// `evokeTrigger`; Solitude/Grief in mh2/white.ts / mh2/black.ts are the
// working precedent). Endurance's OWN remaining gap is different: "up to one
// target PLAYER puts all the cards from their graveyard on the bottom of
// their library in a random order" needs a TRIGGERED ability to choose a
// PLAYER at resolution time — there is no player-picker primitive
// (`SpellContext.requestChoice`'s zones are all object zones: "battlefield" |
// "hand" | "library" | "graveyard"; the closest existing player-targeting
// path, `candidatePlayerIds`, is scoped to `kind: "choose-damage-target"`
// only). Stop-and-issue per gre-development.md; tracked stub.
// tracked-by: #1207
// export const endurance: CardDefinition = {
//     id: "eb0e0404-4846-4891-acfa-bd0951ecf9c6",
//     name: "Endurance",
//     rarity: "mythic",
//     manaCost: { X: 1, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 3,
//     toughness: 4,
// };

export {};
