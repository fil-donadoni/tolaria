// MMQ — blue cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Rishadan Cutpurse — {2}{U} 1/1 Human Pirate. "When this creature enters, each
// opponent sacrifices a permanent of their choice unless they pay {1}." The
// punisher shape: the opponent's cost-bearing `mayPay` (CR 118.12a — "unless"
// offers the payment to the affected player), and only on a decline their own
// `sacrifice-permanents` pick (CR 701.21a) of any permanent they control.
// "Each opponent" is the single opponent of a two-player game, the same
// `player: "opponent"` scoping Portal to Phyrexia's "each opponent sacrifices"
// (bro/colorless.cards.ts) uses.
// compiler-gap: "When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {1}." (#2693)
export const rishadanCutpurse = defineCard(() => ({
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
}));
