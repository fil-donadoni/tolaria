// APC — blue cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Whirlpool Warrior. Its ETB half is the same clause Whirlpool Rider and Drake
// ship COMPILED; only the activated half sits below the hand-tail floor, and a
// card is not split across two authoring paths, so both halves are written
// here.
// CR 608.2h — the effect reads the hand size only once, as it is applied, so
// "that many" is the size BEFORE the cards move; `bindCount` records it as
// the hand empties, because a `draw` placed after the move could only recount
// a hand that is already gone.
// The activated half is the same three Ops under `forEach { set: "players" }`.
// A body binding is scoped to its iteration, so each player gets their own
// count and draws back their OWN hand size. The iterations run in sequence
// rather than `simultaneous`: every iteration touches only that player's hand
// and library, so none of them can observe another's.
// hand-tail: {R}, Sacrifice this creature: Each player shuffles the cards from their hand into their library, then draws that many cards. (#4358)
export const whirlpoolWarrior: CardDefinition = {
    id: "01f891ca-4e6a-4710-b1cf-5dabb5e1ad93",
    rarity: "rare",
    name: "Whirlpool Warrior",
    oracleText:
        "When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.\n{R}, Sacrifice this creature: Each player shuffles the cards from their hand into their library, then draws that many cards.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Warrior"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "whirlpool-warrior-etb-redraw",
            oracleText:
                "When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.",
            scope: "self",
            effects: [
                {
                    op: "moveZone",
                    player: "controller",
                    from: "hand",
                    to: "library",
                    bindCount: "$handSize",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
                {
                    op: "draw",
                    player: "controller",
                    count: { ref: "$handSize" },
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "whirlpool-warrior-each-player-redraw",
            oracleText:
                "{R}, Sacrifice this creature: Each player shuffles the cards from their hand into their library, then draws that many cards.",
            cost: { mana: { R: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "moveZone",
                            player: { ref: "$each" },
                            from: "hand",
                            to: "library",
                            bindCount: "$eachHandSize",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: { ref: "$each" },
                        },
                        {
                            op: "draw",
                            player: { ref: "$each" },
                            count: { ref: "$eachHandSize" },
                        },
                    ],
                },
            ],
        },
    ],
};
