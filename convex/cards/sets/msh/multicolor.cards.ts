// MSH — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { damageTakenTrigger } from "../../abilities/triggers/damageTakenTrigger";
import { opponentsCantCastDuringYourTurn } from "../../tokenStaticEffects";

const JENNIFER_WALTERS_ID = "61237530-ad49-469c-a952-67c92315708e";

// Jennifer Walters // The Sensational She-Hulk — {1}{W} Legendary Creature —
// Human Advisor Hero, 2/3 // {3}{G}{W}{W} Legendary Creature — Gamma Hero, 6/6.
// A MODAL double-faced card (CR 712.3): the back face is CAST for its own cost
// (CR 712.11b, issue #7200), and the front also carries a printed "Transform"
// ability, which the engine turns over through the same registered twin
// (`gre/transform.ts`).
//
// "Your opponents can't cast spells during your turn." (both faces, CR 601.3 /
// 102.1) is the shared read-time cast gate `opponentsCantCastDuringYourTurn`
// (`tokenStaticEffects.ts`): a hand-written `staticEffects` entry on the front,
// the `staticEffectKeys` key on the back face.
//
// "{3}{G}{W}{W}: Transform Jennifer Walters. Activate only as a sorcery." —
// a stack-using activated ability, `sorcerySpeedOnly` (CR 602.5d).
//
// She-Hulk's trigger (CR 603.2 / 120.3): "Whenever a creature you control is
// dealt damage" = `damageTakenTrigger` over a permanent filter (any creature
// you control, She-Hulk included). The target ("any target", CR 115.4) is
// announced as the trigger goes on the stack (CR 603.3d); the "you may" is a
// cost-free `mayPay` decision on resolution (CR 603.5), and the damage is the
// event's amount (`$event.amount`), dealt BY She-Hulk (the default source).
// "Do this only once each turn" is `maxTriggersPerTurn: 1`, a per-source tally
// (counted when the ability triggers, so it caps the trigger rather than the
// accepted offer — the same reading as the other once-per-turn triggers).
//
// hand-tail: Whenever a creature you control is dealt damage (#8171)
export const jenniferWaltersTheSensationalSheHulk = defineCard(() => ({
    id: JENNIFER_WALTERS_ID,
    name: "Jennifer Walters",
    rarity: "mythic",
    oracleText:
        "Your opponents can't cast spells during your turn.\n{3}{G}{W}{W}: Transform Jennifer Walters. Activate only as a sorcery.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Advisor", "Hero"],
    power: 2,
    toughness: 3,
    staticEffects: [
        opponentsCantCastDuringYourTurn("jennifer-walters-opponents-cant-cast"),
    ],
    activatedAbilities: [
        {
            id: "jennifer-walters-transform",
            oracleText:
                "{3}{G}{W}{W}: Transform Jennifer Walters. Activate only as a sorcery.",
            cost: { mana: { X: 3, G: 1, W: 2 } },
            sorcerySpeedOnly: true,
            useStack: true,
            effects: [{ op: "transform", target: { ref: "$source" } }],
        },
    ],
    backFace: {
        kind: "modal",
        name: "The Sensational She-Hulk",
        manaCost: { X: 3, G: 1, W: 2 },
        colors: ["G", "W"],
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Gamma", "Hero"],
        power: 6,
        toughness: 6,
        staticAbilities: ["reach", "trample"],
        staticEffectKeys: ["opponents-cant-cast-during-your-turn"],
        oracleText:
            "Reach, trample\nYour opponents can't cast spells during your turn.\nWhenever a creature you control is dealt damage, you may have The Sensational She-Hulk deal that much damage to any target. Do this only once each turn.",
        imagePrintId: JENNIFER_WALTERS_ID,
        triggeredAbilities: [
            {
                ...damageTakenTrigger({
                    id: "the-sensational-she-hulk-redirect",
                    oracleText:
                        "Whenever a creature you control is dealt damage, you may have The Sensational She-Hulk deal that much damage to any target. Do this only once each turn.",
                    target: {
                        kind: "permanent",
                        filter: {
                            types: "Creature",
                            controllerRelation: "you",
                        },
                    },
                    targetRequirement: { type: "any", count: 1 },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Have The Sensational She-Hulk deal that much damage to the target?",
                            bind: "$deal",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$deal" },
                            then: [
                                {
                                    op: "dealDamage",
                                    amount: { ref: "$event.amount" },
                                    to: { target: 0 },
                                },
                            ],
                        },
                    ],
                }),
                maxTriggersPerTurn: 1,
            },
        ],
    },
}));
