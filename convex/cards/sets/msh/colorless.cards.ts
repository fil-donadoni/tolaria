// MSH — colorless cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, AURA_AFFECTS_HOST } from "../../types";
import { equipAbility } from "../../abilities/equipment";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import {
    nthSpellOfTypeThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";

// The Fantasticar — {3} Legendary Artifact — Vehicle, 4/4 (MSC). "Flying. Whenever you cast a noncreature spell, you may have
// The Fantasticar become an artifact creature until end of turn. Whenever you
// cast your fourth noncreature spell each turn, you may sacrifice The
// Fantasticar. If you do, create four 4/4 colorless Construct artifact
// creature tokens with flying and haste." DSL-first (ADR 0045), no
// `resolve()`.
//
// A Vehicle with NO crew ability, so `makeVehicle` (which always appends
// Crew N) does not fit; the definition is written directly. CR 301.7a/b: it
// has its printed 4/4 only while it is a creature, so the animation is the
// `animate` Op with the printed P/T until end of turn (CR 514.2), exactly the
// body `crewAbility` uses.
//
// "Fourth noncreature spell each turn" is `nthSpellOfTypeThisTurn(4,
// { excludeTypes: "Creature" })` (CR 601.2i): the caster's tally
// snapshotted on the cast event, so a fifth spell cast in response does not
// undo it. Plain `condition`, not `interveningIf` — the Oracle text has no
// "if" clause (CR 603.4).
//
// "You may sacrifice ... If you do" (CR 701.21a): a bare `mayPay` decision,
// then the sacrifice only when The Fantasticar is still on the battlefield
// (`objectMatchesFilter`; a permanent already gone cannot be
// sacrificed, so "if you do" is false and no Constructs appear).
//
// Guard C: the grammar does not consume either trigger head.
// compiler-gap: Whenever you cast a noncreature spell (#7216)
// hand-tail: Whenever you cast your fourth noncreature spell each turn (#7255)
export const theFantasticar = defineCard(() => ({
    id: "ed0beb69-8441-4104-9990-81bd82f81f9a",
    name: "The Fantasticar",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever you cast a noncreature spell, you may have The Fantasticar become an artifact creature until end of turn.\nWhenever you cast your fourth noncreature spell each turn, you may sacrifice The Fantasticar. If you do, create four 4/4 colorless Construct artifact creature tokens with flying and haste.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    subtypes: ["Vehicle"],
    power: 4,
    toughness: 4,
    // CR 702.9 Flying.
    staticAbilities: ["flying"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "the-fantasticar-animate",
            oracleText:
                "Whenever you cast a noncreature spell, you may have The Fantasticar become an artifact creature until end of turn.",
            scope: "you",
            filter: { excludeTypes: "Creature" },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Have The Fantasticar become an artifact creature until end of turn?",
                    bind: "$animate",
                },
                {
                    op: "if",
                    predicate: { binding: "$animate" },
                    then: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 4,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
        spellCastTrigger({
            id: "the-fantasticar-constructs",
            oracleText:
                "Whenever you cast your fourth noncreature spell each turn, you may sacrifice The Fantasticar. If you do, create four 4/4 colorless Construct artifact creature tokens with flying and haste.",
            scope: "you",
            condition: nthSpellOfTypeThisTurn(4, { excludeTypes: "Creature" }),
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Sacrifice The Fantasticar to create four 4/4 Construct tokens?",
                    bind: "$sacrifice",
                },
                {
                    op: "if",
                    predicate: { binding: "$sacrifice" },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { ref: "$source" },
                                filter: { type: "Artifact" },
                            },
                            then: [
                                {
                                    op: "sacrifice",
                                    target: { ref: "$source" },
                                },
                                {
                                    op: "createToken",
                                    token: {
                                        name: "Construct",
                                        types: ["Artifact", "Creature"],
                                        subtypes: ["Construct"],
                                        power: 4,
                                        toughness: 4,
                                        staticAbilities: ["flying", "haste"],
                                    },
                                    controller: "controller",
                                    count: 4,
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
}));

// Iron Man Armor — {3} Artifact — Equipment (MSH, Vintage Cube, issue #7237).
// "When this Equipment enters, attach it to target creature you control.
// Equipped creature gets +2/+1 and has flying. {2}: If this Equipment isn't a
// creature, it becomes a 0/0 Construct Hero artifact creature with flying and
// "This creature gets +1/+1 for each artifact you control" until end of turn.
// Equip {2}". DSL-first (ADR 0045), no `resolve()`.
//
// ETB attach: an announced-target `enteredTrigger` whose body is the `attach`
// Op over target slot 0 (CR 701.3, CR 603.3d).
// Equipped creature gets +2/+1 and has flying: `AURA_AFFECTS_HOST`-scoped
// `pt-buff` + `keyword-grant` (CR 613.4c, 613.1f), the shape Lavaspur Boots
// proves.
//
// The animation: "If this Equipment isn't a creature" is checked at
// resolution (CR 608.2c) by `objectMatchesFilter` over the live, layer-read
// characteristics. `animate` sets the base 0/0, adds Artifact and grants
// flying plus the QUOTED static through `grantedStaticId` (CR 113.1, 611.2a);
// the template's `source` is the recipient at every read (CR 113.3d), so the
// count is the controller's artifacts, itself included. "Construct Hero" is
// two creature types, which `animate`'s single `subtype` cannot express, so a
// `setSubtype` with `family: "creature"` (CR 205.1a) sets both for the same
// duration and keeps the Equipment subtype.
//
// compiler-gap: Equip {2} (#7214)
// compiler-gap: When this Equipment enters, attach it to target creature you control. (#7215)
// compiler-gap: Equipped creature gets +2/+1 and has flying. (#7215)
// hand-tail: If this Equipment isn't a creature, it becomes a N/N Construct Hero artifact creature with flying and "This creature (#7237)
export const ironManArmor = defineCard(() => ({
    id: "361c2f3b-f04e-446b-a683-9195e238daf0",
    name: "Iron Man Armor",
    rarity: "mythic",
    oracleText:
        'When this Equipment enters, attach it to target creature you control.\nEquipped creature gets +2/+1 and has flying.\n{2}: If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and "This creature gets +1/+1 for each artifact you control" until end of turn.\nEquip {2}',
    manaCost: { generic: 3 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 2,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    // Quoted static the animation grants; kept off `staticEffects` so the
    // Equipment itself does not carry it (CR 113.3d).
    staticGrantTemplates: [
        {
            id: "iron-man-armor-artifact-count",
            effect: {
                kind: "pt-buff",
                applies: (target, source) => target.id === source.id,
                computeFor: (source, state) => {
                    let artifacts = 0;
                    for (const player of state.players) {
                        for (const p of player.battlefield) {
                            if (
                                p.controllerId === source.controllerId &&
                                p.types.includes("Artifact")
                            ) {
                                artifacts++;
                            }
                        }
                    }
                    return { power: artifacts, toughness: artifacts };
                },
            },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "iron-man-armor-attach",
            oracleText:
                "When this Equipment enters, attach it to target creature you control.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [{ op: "attach", target: { target: 0 } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "iron-man-armor-animate",
            oracleText:
                '{2}: If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and "This creature gets +1/+1 for each artifact you control" until end of turn.',
            cost: { mana: { generic: 2 } },
            useStack: true,
            animatesSelf: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { excludeType: "Creature" },
                    },
                    then: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 0,
                            toughness: 0,
                            additionalTypes: ["Artifact"],
                            grantedAbilities: ["flying"],
                            grantedStaticId: "iron-man-armor-artifact-count",
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Construct", "Hero"],
                            family: "creature",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
        equipAbility({
            id: "iron-man-armor-equip",
            cost: { generic: 2 },
            oracleText: "Equip {2}",
        }),
    ],
}));
