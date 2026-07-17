// ltc — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Forth Eorlingas! — {X}{R}{W} Sorcery (LTC, issue #1199). "Create X 2/2 red
// Human Knight creature tokens with trample and haste. Whenever one or more
// creatures you control deal combat damage to one or more players this turn,
// you become the monarch." Modern Oracle text per Scryfall (the card has
// never been printed in the base LTR draft set, only in LTC/Commander
// products) — X 2/2 red Human KNIGHT tokens with trample AND haste, not
// "Human Soldier" with trample alone.
//
// Both clauses are Ops (DSL-first, ADR 0045):
//   1. `createToken` with `count: { X: true }` (CR 601.2b — chosen X).
//   2. `delayedTrigger` (CR 603.7, ADR 0048) scheduling a REPEATING
//      combat-damage-to-player watch (`this-turn-creature-deals-combat-
//      damage-to-player`, CR 720.2, issue #1199) whose inline body is a
//      single `becomeMonarch` Op. The watch stays armed the rest of the turn
//      (mirrors the `this-turn-creature-blocks` shape, Battle Cry) and needs
//      no `capture`: at fire time `ctx.controller` already IS the scheduling
//      player (the resolving stack item's own controllerId).
export const forthEorlingas: CardDefinition = {
    id: "06c053d3-028e-4961-93a5-5b7bb5a8601c",
    rarity: "rare",
    name: "Forth Eorlingas!",
    oracleText:
        "Create X 2/2 red Human Knight creature tokens with trample and haste.\nWhenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch.",
    manaCost: { X: "X", R: 1, W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            token: {
                name: "Human Knight",
                types: ["Creature"],
                subtypes: ["Human", "Knight"],
                power: 2,
                toughness: 2,
                colors: ["R"],
                staticAbilities: ["trample", "haste"],
                imagePrintId: "491fc1c3-a46e-4cfd-a749-57f4c96f6aea",
            },
            controller: "controller",
            count: { X: true },
        },
        {
            op: "delayedTrigger",
            timing: "this-turn-creature-deals-combat-damage-to-player",
            oracleText:
                "Whenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch.",
            effects: [{ op: "becomeMonarch" }],
        },
    ],
};
