// ZNR — blue cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { additionalCostPaidCondition } from "../../abilities/triggers/shared";

// Glasspool Mimic // Glasspool Shore — {2}{U} Creature — Shapeshifter Rogue,
// 0/0 // Land (ZNR, issue #10508, modern Merfolk). "You may have this creature
// enter as a copy of a creature you control, except it's a Shapeshifter Rogue
// in addition to its other types." Back face: "This land enters tapped. {T}:
// Add {U}."
//   - CR 614.1c — "enters as a copy" is a replacement effect, declared as
//     data (`entersWith.asEnters`, ADR 0100 D3) so the choice is raised on
//     every entry path, Clone's shape.
//   - "a creature you control" is `controller: "you"`: only the battlefield
//     of the player it enters under is offered.
//   - CR 707.9b — "except it's a Shapeshifter Rogue in addition to its other
//     types" modifies the copiable subtypes: `additionalSubtypes`.
//   - Declining (or controlling no other creature) leaves the printed 0/0,
//     which dies to SBA (CR 704.5f).
//   - CR 712.12 — a modal DFC: the back is a land that is only ever played
//     (`kind: "modal"`, no manaCost), entering tapped.
//
// hand-tail: You may have this creature enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types. (#10508)
export const glasspoolMimicGlasspoolShore = defineCard(() => ({
    id: "5adcb500-8c77-4925-8e2c-1243502827d1", // ZNR 60
    name: "Glasspool Mimic",
    rarity: "rare",
    oracleText:
        "You may have this creature enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter", "Rogue"],
    power: 0,
    toughness: 0,
    // Bot-only cast prune (#938): a wasted cast (a 0/0 that dies to SBA) when
    // no creature is in play.
    copySourceFilter: { types: "Creature" },
    // Phantasmal Image's valuation (m12/blue.cards.ts): a creature's own
    // as-enters copy declaration is invisible to `latentValue`, so a
    // representative 2/2 body at this card's mana value stands in for "a copy
    // of a creature you already control".
    aiValue: {
        representativeBody: { power: 2, toughness: 2, manaValue: 3 },
        premium: 0,
    },
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                filter: { types: "Creature" },
                controller: "you",
                opts: { additionalSubtypes: ["Shapeshifter", "Rogue"] },
            },
        ],
    },
    backFace: {
        kind: "modal",
        name: "Glasspool Shore",
        types: ["Land"],
        activatedAbilities: [
            {
                id: "glasspool-shore-mana",
                oracleText: "{T}: Add {U}.",
                cost: { tap: true },
                useStack: false,
                manaProduced: { U: 1 },
            },
        ],
        entersTapped: true,
        oracleText: "This land enters tapped.\n{T}: Add {U}.",
    },
}));

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
