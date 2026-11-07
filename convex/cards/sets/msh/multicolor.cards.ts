// MSH — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { EffectOp, EffectPredicate } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { damageTakenTrigger } from "../../abilities/triggers/damageTakenTrigger";
import { opponentsCantCastDuringYourTurn } from "../../tokenStaticEffects";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

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
// "Do this only once each turn" (CR 603.2h) is `maxTriggersPerTurn: 1`, a
// per-source trigger tally: a documented deviation, out of scope for this
// hand-tail pass. CR 603.2h gates the trigger on whether the indicated action
// (dealing the damage) was actually TAKEN this turn, not on how many times the
// ability fired. So here a declined "may", or a trigger that fizzles on an
// illegal target, still spends the turn's one trigger, and simultaneous combat
// damage to several creatures puts only the first event's amount on the stack
// (CR 603.2h would put one trigger per creature until the damage is dealt).
// The CR-faithful fix is new per-turn "action taken" state in `convex/gre/**`,
// shared with Ancient Cornucopia (`sets/big/green.cards.ts`); see
// docs/findings/8171-she-hulk-cr603-2h-action-taken.md.
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

// Absorbing Man — {1}{G}{U} Legendary Creature — Human Villain, 4/4 (Vintage
// Cube, issue #8175). "Vigilance. At the beginning of your first main phase,
// until your next turn, Absorbing Man becomes a copy of up to one target
// artifact, non-Aura enchantment, or land, except his name is Absorbing Man,
// he's a legendary 4/4 Human Villain creature in addition to his other types,
// and he has vigilance."
//
// Pure Effect Script on the `becomeCopy` Op (issue #8167 built every piece):
//   - "up to one target" is `count: { min: 0, max: 1 }` — announcing none
//     leaves Absorbing Man as he is (CR 601.2c, 603.3d);
//   - "until your next turn" is the `untap` boundary of the controller
//     (CR 500.4), so the copy ends as their next untap step begins;
//   - the exceptions are copiable values (CR 707.9b): the name, the Legendary
//     supertype, the 4/4 base P/T, the Creature type and the Human Villain
//     subtypes ride on `except`; vigilance is `additionalStaticAbilities`.
//
// hand-tail: Until your next turn, {self} becomes a copy of up to one target (#8175)
export const absorbingMan = defineCard(() => ({
    id: "7114ef87-53ff-43e9-864c-9faa455d86ef",
    name: "Absorbing Man",
    rarity: "rare",
    oracleText:
        "Vigilance\nAt the beginning of your first main phase, until your next turn, Absorbing Man becomes a copy of up to one target artifact, non-Aura enchantment, or land, except his name is Absorbing Man, he's a legendary 4/4 Human Villain creature in addition to his other types, and he has vigilance.",
    manaCost: { X: 1, G: 1, U: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Villain"],
    power: 4,
    toughness: 4,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        phaseTrigger({
            id: "absorbing-man-copy",
            oracleText:
                "At the beginning of your first main phase, until your next turn, Absorbing Man becomes a copy of up to one target artifact, non-Aura enchantment, or land, except his name is Absorbing Man, he's a legendary 4/4 Human Villain creature in addition to his other types, and he has vigilance.",
            phase: "PRECOMBAT_MAIN",
            scope: "your",
            targetRequirement: {
                type: ["Artifact", "Enchantment", "Land"],
                excludeSubtypes: "Aura",
                count: { min: 0, max: 1 },
            },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    duration: { phase: "untap", player: "controller" },
                    except: {
                        name: "Absorbing Man",
                        additionalSupertypes: ["Legendary"],
                        basePower: 4,
                        baseToughness: 4,
                        additionalTypes: ["Creature"],
                        additionalSubtypes: ["Human", "Villain"],
                        additionalStaticAbilities: ["vigilance"],
                    },
                },
            ],
        }),
    ],
}));

// Cloak and Dagger, Entwined — {1}{W}{B} Legendary Creature — Human Hero, 2/2
// (MSH, issue #8172). "Deathtouch, lifelink\nWhen Cloak and Dagger enter,
// choose target opponent and up to one target creature they control. They
// reveal their hand. You may exile a nonland card from their hand or the
// chosen creature until Cloak and Dagger leave the battlefield."
//
// Two independent target groups announced as the trigger goes on the stack
// (CR 603.3d -> CR 601.2c, issue #8475): the opponent is `{ target: 0 }`, the
// "up to one" creature they control `{ target: 1 }` (CR 608.2b: nothing chosen
// resolves to nothing).
//
// The exile is "a nonland card from their hand OR the chosen creature": one
// pick: a cost-free `mayPay` (the "may"), then an `optionChoice` between the
// two sides only when BOTH exist; each side is gated by an `if` so a missing
// option raises no redundant prompt (a hand with only lands, no creature
// chosen). The hand count sits right after the `reveal` (CR 701.20a), which
// is what makes the filtered read legal.
//   - Hand branch: Deep-Cavern Bat's `choice` `choose-hand-card` + `moveZone`
//     with `linkToSource` (CR 607 linked abilities) and `untilSourceLeaves`
//     (CR 610.3b: the source already left before this trigger resolved, so the
//     card does not move). The `reveal` of the hand is its own game action
//     (CR 701.20a) and happens regardless.
//   - Creature branch: `exileWithAttachments` over `{ target: 1 }` (Aang's
//     Iceberg, ADR 0028); it refuses a departed source itself (CR 610.3b).
// The leave trigger runs BOTH returns: the linked hand card goes to its
// owner's hand (CR 400.7), the held creature returns to the battlefield. Each
// is keyed to its own store (`exiledBySourceId` vs the `exileHeld` bundle), so
// neither picks up the other's object, and a side that holds nothing is a
// CR 608.2b no-op.
//
// The "until" return is a leaves-the-battlefield trigger, the same model
// Deep-Cavern Bat and Aang's Iceberg ship (CR 610.3).
// hand-tail: Choose target opponent and up to one target creature they control (#8172)
export const cloakAndDaggerEntwined = defineCard(() => {
    const exileFromHand: EffectOp[] = [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "hand",
            filter: { excludeType: "Land" },
            count: { min: 1, max: 1 },
            prompt: "Exile a nonland card from their hand.",
            bind: "$taken",
        },
        {
            op: "moveZone",
            cards: { ref: "$taken" },
            player: { target: 0 },
            from: "hand",
            to: "exile",
            linkToSource: true,
            untilSourceLeaves: true,
        },
    ];
    const exileCreature: EffectOp[] = [
        { op: "exileWithAttachments", target: { target: 1 } },
    ];
    const handModeLabel = "Exile a nonland card from their hand";
    const creatureModeLabel = "Exile the chosen creature";
    const hasNonlandInHand: EffectPredicate = {
        left: {
            count: {
                zone: "hand",
                controller: { target: 0 },
                filter: { excludeType: "Land" },
            },
        },
        op: "ge",
        right: 1,
    };
    const hasChosenCreature: EffectPredicate = {
        objectMatchesFilter: { target: 1 },
        filter: { type: "Creature" },
    };
    return {
        id: "fa01d35f-1064-4a7c-9475-4504566df850",
        name: "Cloak and Dagger, Entwined",
        rarity: "rare",
        oracleText:
            "Deathtouch, lifelink\nWhen Cloak and Dagger enter, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until Cloak and Dagger leave the battlefield.",
        manaCost: { generic: 1, W: 1, B: 1 },
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Human", "Hero"],
        power: 2,
        toughness: 2,
        staticAbilities: ["deathtouch", "lifelink"],
        triggeredAbilities: [
            enteredTrigger({
                id: "cloak-and-dagger-entwined-exile",
                oracleText:
                    "When Cloak and Dagger enter, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until Cloak and Dagger leave the battlefield.",
                scope: "self",
                targetRequirement: {
                    type: "player",
                    count: 1,
                    controller: "opponent",
                },
                additionalTargetRequirements: [
                    {
                        type: "Creature",
                        count: { min: 0, max: 1 },
                        controller: "opponent",
                    },
                ],
                effects: [
                    { op: "reveal", player: { target: 0 }, zone: "hand" },
                    {
                        op: "if",
                        predicate: hasNonlandInHand,
                        then: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Exile a nonland card from their hand or the chosen creature?",
                                bind: "$exile",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$exile" },
                                then: [
                                    {
                                        op: "if",
                                        predicate: hasChosenCreature,
                                        then: [
                                            {
                                                op: "optionChoice",
                                                prompt: "Exile a nonland card from their hand or the chosen creature?",
                                                modes: [
                                                    {
                                                        id: "hand",
                                                        label: handModeLabel,
                                                        effects: exileFromHand,
                                                    },
                                                    {
                                                        id: "creature",
                                                        label: creatureModeLabel,
                                                        effects: exileCreature,
                                                    },
                                                ],
                                            },
                                        ],
                                        else: exileFromHand,
                                    },
                                ],
                            },
                        ],
                        else: [
                            {
                                op: "if",
                                predicate: hasChosenCreature,
                                then: [
                                    {
                                        op: "mayPay",
                                        player: "controller",
                                        prompt: "Exile the chosen creature?",
                                        bind: "$exileCreature",
                                    },
                                    {
                                        op: "if",
                                        predicate: {
                                            binding: "$exileCreature",
                                        },
                                        then: exileCreature,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }),
            leftTrigger({
                id: "cloak-and-dagger-entwined-return",
                oracleText:
                    "When Cloak and Dagger leave the battlefield, return the exiled card to its owner's hand and the exiled creature to the battlefield under its owner's control.",
                scope: "self",
                effects: [
                    {
                        op: "moveZone",
                        target: { exiledWithSource: true },
                        to: "hand",
                    },
                    { op: "returnExiledForSource" },
                ],
            }),
        ],
    };
});
