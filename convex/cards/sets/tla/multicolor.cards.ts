// TLA — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { waterbendCost } from "../../abilities/waterbend";

const AANG_AT_THE_CROSSROADS_ID = "fea89ca0-8070-4f28-9851-994314f9d248";

// Aang, at the Crossroads // Aang, Destined Savior (issue #3249, Scryfall tla
// #203) — {2}{G}{W}{U} Legendary Creature — Human Avatar Ally, 3/3, flying.
//
// FRONT, ETB (CR 603.6a): "look at the top five cards of your library. You may
// put a creature card with mana value 4 or less from among them onto the
// battlefield. Put the rest on the bottom of your library in a random order."
// One `lookDistribute` — `keepTo: "battlefield"` PUTS the pick (never casts it:
// no cast trigger, and it enters summoning sick), `take: 1` + `optional: true`
// is "you may put a creature card", the filter reads mana value off the card in
// the library (CR 202.3), and `randomBottom` is "in a random order". "Look",
// not "reveal": nothing is shown to the opponent until the pick hits the
// battlefield.
//
// FRONT, leaves-the-battlefield (CR 603.6c / 603.10a): "When another creature
// you control leaves the battlefield, transform Aang at the beginning of the
// next upkeep." `leftTrigger` scope `another-yours` + a Creature filter read
// off the departure event's last-known types, so Aang himself never counts.
// Its body schedules a `next-upkeep` delayed trigger (CR 603.7a) whose capture
// freezes THIS Aang: if he leaves and comes back first he is a new object (CR
// 400.7) and the capture is dropped at his re-entry, and if several creatures
// leave, the second delayed trigger finds Aang already transformed since it
// was created and does nothing (CR 701.27f) — both answered by the engine, not
// the card.
//
// BACK: Aang, Destined Savior, 4/4 Legendary Creature — Avatar Ally, flying, no
// colour indicator. "Land creatures you control have vigilance." is the layer-6
// type-intersection grant `vigilance-land-creatures-you-control`. "At the
// beginning of combat on your turn, earthbend 2." is the same three-Op
// earthbend Badgermole Cub ships (tla/green.ts, CR 701.66a) with two counters,
// on a phase trigger that lives on the back face itself.
//
// compiler-gap: "look at the top five cards of your library. You may put a creature card with mana value 4 or less from among them onto the battlefield" (#2693)
// compiler-gap: "transform Aang at the beginning of the next upkeep" (#2693)
export const aangAtTheCrossroads = defineCard(() => ({
    id: AANG_AT_THE_CROSSROADS_ID,
    name: "Aang, at the Crossroads",
    rarity: "rare",
    oracleText:
        "Flying\nWhen Aang enters, look at the top five cards of your library. You may put a creature card with mana value 4 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.\nWhen another creature you control leaves the battlefield, transform Aang at the beginning of the next upkeep.",
    manaCost: { X: 2, G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Avatar", "Ally"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "aang-at-the-crossroads-etb",
            oracleText:
                "When Aang enters, look at the top five cards of your library. You may put a creature card with mana value 4 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "battlefield",
                    player: "controller",
                    look: 5,
                    take: 1,
                    optional: true,
                    filter: { type: "Creature", manaValueAtMost: 4 },
                    randomBottom: true,
                    prompt: "You may put a creature card with mana value 4 or less onto the battlefield.",
                },
            ],
        }),
        leftTrigger({
            id: "aang-at-the-crossroads-transform",
            oracleText:
                "When another creature you control leaves the battlefield, transform Aang at the beginning of the next upkeep.",
            scope: "another-yours",
            filter: { types: "Creature" },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "next-upkeep",
                    oracleText: "Transform Aang.",
                    capture: { $aang: { ref: "$source" } },
                    effects: [{ op: "transform", target: { ref: "$aang" } }],
                },
            ],
        }),
    ],
    backFace: {
        name: "Aang, Destined Savior",
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Avatar", "Ally"],
        power: 4,
        toughness: 4,
        staticAbilities: ["flying"],
        staticEffectKeys: ["vigilance-land-creatures-you-control"],
        oracleText:
            "Flying\nLand creatures you control have vigilance.\nAt the beginning of combat on your turn, earthbend 2. (Target land you control becomes a 0/0 creature with haste that's still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)",
        imagePrintId: AANG_AT_THE_CROSSROADS_ID,
        triggeredAbilities: [
            phaseTrigger({
                id: "aang-destined-savior-earthbend",
                oracleText:
                    "At the beginning of combat on your turn, earthbend 2. (Target land you control becomes a 0/0 creature with haste that's still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)",
                phase: "BEGINNING_OF_COMBAT",
                scope: "your",
                targetRequirement: {
                    type: "Land",
                    count: 1,
                    controller: "you",
                },
                effects: [
                    {
                        op: "animate",
                        target: { target: 0 },
                        power: 0,
                        toughness: 0,
                        grantedAbilities: ["haste"],
                    },
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        count: 2,
                        target: { target: 0 },
                    },
                    {
                        op: "delayedTrigger",
                        timing: "leaves-battlefield-indefinite",
                        oracleText:
                            "When it dies or is exiled, return it to the battlefield tapped.",
                        watch: { target: 0 },
                        capture: { $land: { target: 0 } },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$land" },
                                from: "graveyard",
                                to: "battlefield",
                                tapped: true,
                                controller: "controller",
                            },
                            {
                                op: "moveZone",
                                target: { ref: "$land" },
                                from: "exile",
                                to: "battlefield",
                                tapped: true,
                                controller: "controller",
                            },
                        ],
                    },
                ],
            }),
        ],
    },
}));

// Aang, Swift Savior // Aang and La, Ocean's Fury — {1}{W}{U} Legendary Creature,
// 2/3 with flash and flying, issue #3551.
// Airbend (CR 701.65a): "creature or spell" is the mixed `type: ["Creature",
// "spell"]`, the battlefield half read by card type and the stack half by
// `spell`, and removing a spell this way is not countering it. "Up to one"
// announces zero or one (CR 601.2c), and a slot left empty no-ops.
// Waterbend {8} is `waterbendCost` (CR 701.67a).
// Transform turns over to the back face (CR 701.27).
const AANG_SWIFT_SAVIOR_ID = "82866a0e-485a-4f7e-8c49-f7d9ff3f4ad4";
//
// compiler-gap: "When {self} enters, airbend up to one other target creature or spell." (#2693)
// compiler-gap: "Waterbend {8}: Transform {self}." (#2693)
// compiler-gap: "Whenever {self} attack, put a +1/+1 counter on each tapped creature you control." (#2693)
export const aangSwiftSavior = defineCard(() => ({
    id: AANG_SWIFT_SAVIOR_ID,
    name: "Aang, Swift Savior",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWhen Aang enters, airbend up to one other target creature or spell. (Exile it. While it's exiled, its owner may cast it for {2} rather than its mana cost.)\nWaterbend {8}: Transform Aang.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Avatar", "Ally"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "aang-swift-savior-airbend",
            oracleText:
                "When Aang enters, airbend up to one other target creature or spell.",
            scope: "self",
            targetRequirement: {
                type: ["Creature", "spell"],
                count: { min: 0, max: 1 },
                excludeSource: true,
            },
            effects: [{ op: "airbend", target: { target: 0 } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "aang-swift-savior-transform",
            oracleText: "Waterbend {8}: Transform Aang.",
            cost: waterbendCost(8),
            useStack: true,
            effects: [{ op: "transform", target: { ref: "$source" } }],
        },
    ],
    backFace: {
        name: "Aang and La, Ocean's Fury",
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Avatar", "Spirit", "Ally"],
        power: 5,
        toughness: 5,
        staticAbilities: ["reach", "trample"],
        oracleText:
            "Reach, trample\nWhenever Aang and La attack, put a +1/+1 counter on each tapped creature you control.",
        imagePrintId: AANG_SWIFT_SAVIOR_ID,
        triggeredAbilities: [
            attacksTrigger({
                id: "aang-and-la-counters",
                oracleText:
                    "Whenever Aang and La attack, put a +1/+1 counter on each tapped creature you control.",
                scope: "self",
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Creature", tapped: true },
                        },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                count: 1,
                                target: { ref: "$each" },
                            },
                        ],
                    },
                ],
            }),
        ],
    },
}));
