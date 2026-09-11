// LGN (Legions) — red cards, split by colour per ADR 0043. The registry's
// `import * as lgn from "./sets/lgn"` resolves through lgn/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { cyclingAbility, cycledTrigger } from "../../abilities/cycling";

// Gempalm Incinerator — {2}{R} 2/1 Goblin whose whole job is to be cycled:
// "Cycling {1}{R}" (CR 702.29a — an activated ability usable only from the
// hand, the shared `cyclingAbility` factory) plus "When you cycle this card,
// you may have it deal X damage to target creature, where X is the number of
// Goblins on the battlefield." (CR 702.29c — the "when you cycle" trigger,
// the `cycledTrigger` template, which keys on the ONE `CARD_DISCARDED` event
// the cycling cost marks `cause: "cycling"`.)
//
// Target and choice sit at different times, the Decree of Silence
// (`scg/blue.ts`) split: the creature is announced as the trigger goes on the
// stack (mandatory `count: 1`), and the "you may" is a RESOLUTION-time
// decision — the costless `mayPay` + `if` shape. An "up to one" target would
// move the decision to announcement and let the controller decline before the
// opponent ever sees what was targeted.
//
// X is the `count` construct over every Goblin on the battlefield, both
// sides' (the Oracle line scopes it to no controller), counted when the
// ability resolves (CR 608.2h). No `dealDamage.source` override: the damage
// comes from the cycled card itself, which is exactly the resolving ability's
// own source object — the Op's default.
//
// compiler-gap: When you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield. (#2693)
export const gempalmIncinerator: CardDefinition = {
    id: "2687c311-fd0c-4fe0-bce8-e3f412216796", // LGN 94
    rarity: "uncommon",
    name: "Gempalm Incinerator",
    oracleText:
        "Cycling {1}{R} ({1}{R}, Discard this card: Draw a card.)\nWhen you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 1,
    activatedAbilities: [cyclingAbility({ X: 1, R: 1 })],
    triggeredAbilities: [
        cycledTrigger({
            id: "gempalm-incinerator-cycled-bolt",
            oracleText:
                "When you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Have Gempalm Incinerator deal damage to the targeted creature?",
                    bind: "$shoot",
                },
                {
                    op: "if",
                    predicate: { binding: "$shoot" },
                    then: [
                        {
                            op: "dealDamage",
                            amount: {
                                count: {
                                    zone: "battlefield",
                                    acrossAllPlayers: true,
                                    filter: { subtype: "Goblin" },
                                },
                            },
                            to: { target: 0 },
                        },
                    ],
                },
            ],
        }),
    ],
};
