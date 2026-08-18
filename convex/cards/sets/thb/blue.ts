// thb — blue cards (ADR 0043 colour split).

import type { CardDefinition, EffectOp } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Thassa's Oracle's ETB (CR 401.4 look/distribute + CR 700.5 Devotion +
// CR 104.2a alternate win, issue #2070): look at the top X cards of the
// library, where X is the controller's devotion to blue — a thin
// `lookDistribute` call whose `look` is the tenth `EffectValue` grammar
// member (`{ devotion: { of, color } }`) rather than a literal count. Put up
// to one on TOP of the library (`keepTo: "library-top"`, the Op's second
// destination — issue #2070) and the rest on the BOTTOM in a random order
// (`randomBottom` — CR 401.4's random order is unobservable for face-down
// cards, matching Narset's precedent). Then win the game if X is greater
// than or equal to the number of cards in the library — evaluated AFTER
// `lookDistribute` completes, so it reads devotion at THIS point (a dead
// Oracle no longer contributes its own {U}{U}, CR 608.2b) against the TRUE
// post-resolution library size: `keepTo: "library-top"` never removes a card
// from the library (unlike the hand-keeping cards every other
// `lookDistribute` user ships), so the count naturally includes every
// looked-at card back where it landed — an empty library plus devotion >= 0
// wins (CR 104.2a, `winGame` — the same alternate-win seam Coalition Victory
// uses).
const thassasOracleValue: EffectOp[] = [
    {
        op: "lookDistribute",
        player: "controller",
        look: { devotion: { of: "controller", color: "U" } },
        take: 1,
        optional: true,
        keepTo: "library-top",
        randomBottom: true,
    },
    {
        op: "if",
        predicate: {
            left: { devotion: { of: "controller", color: "U" } },
            op: "ge",
            right: { count: { zone: "library", controller: "controller" } },
        },
        then: [{ op: "winGame", player: "controller" }],
    },
];

// Thassa's Oracle — {U}{U} Creature — Merfolk Wizard 1/3.
// "When this creature enters, look at the top X cards of your library, where
//  X is your devotion to blue. Put up to one of them on top of your library
//  and the rest on the bottom of your library in a random order. If X is
//  greater than or equal to the number of cards in your library, you win the
//  game." (CR 401.4 / CR 700.5 / CR 104.2a.)
export const thassasOracle: CardDefinition = {
    id: "726e8b29-13e9-4138-b6a9-d2a0d8188d1c",
    name: "Thassa's Oracle",
    rarity: "rare",
    oracleText:
        "When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "thassas-oracle-etb",
            oracleText:
                "When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.",
            scope: "self",
            effects: thassasOracleValue,
        }),
    ],
};
