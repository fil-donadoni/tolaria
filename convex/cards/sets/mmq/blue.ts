// MMQ — blue cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, CardPrint } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Counterspell — MMQ reprint of the LEA instant ("Counter target spell").
// CardPrint onto the LEA definition (ADR 0014).
export const counterspellMmq: CardPrint = {
    printId: "7bd03c80-7812-4704-9e07-9cf73b49c01f",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    setCode: "mmq",
    rarity: "common",
};

// Gush — "You may return two Islands you control to their owner's hand rather
// than pay this spell's mana cost. Draw two cards." (CR 118.9 alternative cost;
// CR 120.1 / draw.) The alternative cost is a censusless rules concept (no
// keyword name); the resolution effect is a single already-censused `draw` Op.
export const gush: CardDefinition = {
    id: "e755bbef-bf34-49c0-ae72-d70e3599de52", // MMQ 82
    rarity: "common",
    name: "Gush",
    oracleText:
        "You may return two Islands you control to their owner's hand rather than pay this spell's mana cost.\nDraw two cards.",
    manaCost: { X: 4, U: 1 },
    types: ["Instant"],
    alternativeCosts: [
        {
            id: "return-two-islands",
            description: "Return two Islands you control to their owner's hand",
            permanent: {
                action: "return",
                count: 2,
                filter: { subtypes: "Island" },
            },
        },
    ],
    effects: [{ op: "draw", player: "controller", count: 2 }],
};

// Thwart — "You may return three Islands you control to their owner's hand
// rather than pay this spell's mana cost. Counter target spell." (CR 118.9
// alternative cost; CR 701.6a counter.) The resolution effect is a single
// already-censused `counter` Op.
export const thwart: CardDefinition = {
    id: "c12a0717-e9ea-4be3-a29f-179671ed4489", // MMQ 108
    rarity: "uncommon",
    name: "Thwart",
    oracleText:
        "You may return three Islands you control to their owner's hand rather than pay this spell's mana cost.\nCounter target spell.",
    manaCost: { X: 2, U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    alternativeCosts: [
        {
            id: "return-three-islands",
            description:
                "Return three Islands you control to their owner's hand",
            permanent: {
                action: "return",
                count: 3,
                filter: { subtypes: "Island" },
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Rishadan Cutpurse — {2}{U} 1/1 Human Pirate. "When this creature enters, each
// opponent sacrifices a permanent of their choice unless they pay {1}." The
// punisher shape: the opponent's cost-bearing `mayPay` (CR 118.12a — "unless"
// offers the payment to the affected player), and only on a decline their own
// `sacrifice-permanents` pick (CR 701.21a) of any permanent they control.
// "Each opponent" is the single opponent of a two-player game, the same
// `player: "opponent"` scoping Portal to Phyrexia's "each opponent sacrifices"
// (bro/colorless.ts) uses.
// compiler-gap: "When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {1}." (#2693)
export const rishadanCutpurse: CardDefinition = {
    id: "947fc270-11e3-46cd-9086-e880a5845c79", // MMQ 93
    rarity: "common",
    name: "Rishadan Cutpurse",
    oracleText:
        "When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {1}.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Pirate"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "rishadan-cutpurse-etb",
            oracleText:
                "When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {1}.",
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "opponent",
                    cost: { X: 1 },
                    prompt: "Pay {1}, or sacrifice a permanent (Rishadan Cutpurse)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: "opponent",
                            zone: "battlefield",
                            count: 1,
                            prompt: "Rishadan Cutpurse: choose a permanent to sacrifice.",
                            bind: "$sac",
                        },
                        { op: "sacrifice", permanents: { ref: "$sac" } },
                    ],
                },
            ],
        }),
    ],
};
