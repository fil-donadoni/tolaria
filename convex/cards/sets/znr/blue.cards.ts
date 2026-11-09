// ZNR — blue cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { additionalCostPaidCondition } from "../../abilities/triggers/shared";

// Thieving Skydiver — {1}{U} Creature — Merfolk Rogue, 2/1 (issue #3248).
// "Kicker {X}. X can't be 0. / Flying / When this creature enters, if it was
// kicked, gain control of target artifact with mana value X or less. If that
// artifact is an Equipment, attach it to this creature."
//
// CR 107.3a — "Kicker {X}" is a Kicker whose mana leg carries the `X: "X"`
// marker, priced at the spell's one announced X (Verdeloth the Ancient's
// shape, issue #2141). CR 107.3 / 601.2b — "X can't be 0" is `minX: 1` on
// that Kicker: kicking for 0 is an illegal announcement, not kicking stays
// legal (`paidKickersMinX`).
// CR 603.4 — the intervening "if it was kicked" is the Verduran Emissary pair
// (check-time `conditionOnSelf` + resolution-time `additionalCostPaid`).
// The target's "mana value X or less" is `mvFilter.max: "X"`, X being the X of
// the spell that became this permanent, fixed as the trigger is put on the
// stack (CR 603.3d).
// CR 701.3a/701.3b — "attach it to this creature" is `attach` with an explicit
// `attachment` (the stolen artifact) onto `$source`, guarded by the live
// "is an Equipment" check; a Skydiver that has left the battlefield makes the
// attach a no-op (CR 608.2b) while the control change still happens.
// compiler-gap: "When this creature enters, if it was kicked, gain control of target artifact with mana value X or less. If that artifact is an Equipment, attach it to this creature." (#2693)
export const thievingSkydiver = defineCard(() => ({
    id: "ff84ea71-e477-44f7-a3f8-77fef708efeb",
    name: "Thieving Skydiver",
    rarity: "rare",
    oracleText:
        "Kicker {X}. X can't be 0. (You may pay an additional {X} as you cast this spell.)\nFlying\nWhen this creature enters, if it was kicked, gain control of target artifact with mana value X or less. If that artifact is an Equipment, attach it to this creature.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Rogue"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flying"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {X}",
            mana: { X: "X" },
            minX: 1,
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "thieving-skydiver-kicked",
            oracleText:
                "When this creature enters, if it was kicked, gain control of target artifact with mana value X or less. If that artifact is an Equipment, attach it to this creature.",
            scope: "self",
            // CR 603.4 check-time gate — see Verduran Emissary.
            conditionOnSelf: additionalCostPaidCondition("kicker"),
            targetRequirement: {
                type: "Artifact",
                count: 1,
                mvFilter: { max: "X" },
            },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "kicker" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "gainControl",
                            target: { target: 0 },
                            controller: "controller",
                        },
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { target: 0 },
                                filter: { subtype: "Equipment" },
                            },
                            then: [
                                {
                                    op: "attach",
                                    attachment: { target: 0 },
                                    target: { ref: "$source" },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
}));
