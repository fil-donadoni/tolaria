// LTR — white cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Eagles of the North — "Flying. When this creature enters, creatures you
// control get +1/+0 and gain first strike until end of turn. Plainscycling
// {1}." (Issue #1839.)
//
// Three clauses, all declarative:
//  - Flying: CR 702.9, a plain `staticAbilities` keyword.
//  - The ETB team pump: CR 603.6a `enteredTrigger` + the standard
//    `forEach` over the controller's battlefield creatures with `pump` +
//    `grantAbility`, both `duration: { phase: "end-of-turn" }` (CR 514.2
//    cleanup reverts them). Same shape as Garruk Wildspeaker's −4.
//  - Plainscycling {1}: CR 702.29e typecycling — `typecyclingAbility`, which
//    shares plain Cycling's activation shell (CR 702.29f).
export const eaglesOfTheNorth: CardDefinition = {
    id: "c1bd3bc0-77bd-40fe-b4f1-835a04cb6e41",
    name: "Eagles of the North",
    rarity: "common",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Bird", "Soldier"],
    power: 3,
    toughness: 3,
    oracleText:
        "Flying\nWhen this creature enters, creatures you control get +1/+0 and gain first strike until end of turn.\nPlainscycling {1} ({1}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)",
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "eagles-of-the-north-etb-pump",
            oracleText:
                "When this creature enters, creatures you control get +1/+0 and gain first strike until end of turn.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "grantAbility",
                            ability: "first strike",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
    ],
    // CR 702.29e/f — Plainscycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Plains")],
};

// Reprieve — "Return target spell to its owner's hand. Draw a card." (Issue
// #2605.) Two declarative clauses, one Op each:
//  - CR 400.7 stack departure: `moveSpellFromStack` with `destination: "hand"`
//    — NOT a counter, so a spell whose "can't be countered" ability functions
//    on the stack (CR 113.6g) is returned all the same: that ability answers
//    only countering (CR 701.6a). The returned card is a new object with no
//    memory of the cast: its targets, modes and the mana spent on it are all
//    simply gone.
//  - CR 121.1 draw: the cantrip half, ordered AFTER the return so the drawn
//    card cannot be the returned one.
// The whole spell is subject to CR 608.2b like any single-target spell: with
// its only target no longer on the stack, Reprieve does not resolve at all and
// its controller draws nothing.
export const reprieve: CardDefinition = {
    id: "1bd3fa8a-6c50-4f7f-9ae3-0810eec5e3db",
    name: "Reprieve",
    rarity: "uncommon",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    oracleText: "Return target spell to its owner's hand.\nDraw a card.",
    // CR 112.1 — "A spell is a card on the stack": "target spell" targets a
    // spell, never an ability (the default `spellStackKind`). A COPY of a
    // spell is also a spell (CR 112.1a), so it is a legal target here — and
    // ceases to exist rather than reaching a hand (CR 707.10a).
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "moveSpellFromStack",
            target: { target: 0 },
            destination: "hand",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
