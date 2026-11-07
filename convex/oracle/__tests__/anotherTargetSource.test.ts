// "another target" with no earlier target on a triggered ability: a target
// other than the ability's own source (CR 603.3d, CR 601.2c, issue #8449).
//
//  1. GOLDEN — one real corpus card per accepted head, compiled whole.
//  2. REFUSALS — a head naming another object the word could mean, and "it"
//     behind a head naming an object, stay unparsed.
//  3. BEHAVIOUR — the source is no legal target through the real trigger
//     machinery, including a dies trigger whose source is by then a card in
//     the graveyard the target is chosen from.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { expandCompiledTriggers } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { raiseTriggerTargetSelection } from "../../gre/rules";
import { destroyWithReplacements, type GameState } from "../../gre/state";
import { buildTriggerItem, collectTriggers } from "../../gre/triggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const FLICKERWISP = oracleCard({
    oracleId: "b23a3d30-6b8e-4aad-890f-db0c3af43ace",
    name: "Flickerwisp",
    manaCost: "{1}{W}{W}",
    typeLine: "Creature — Elemental",
    oracleText:
        "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
    power: "3",
    toughness: "1",
});

const JUNK_DIVER = oracleCard({
    oracleId: "08c595da-9305-42a9-b72f-5ccc546edc01",
    name: "Junk Diver",
    manaCost: "{3}",
    typeLine: "Artifact Creature — Bird",
    oracleText:
        "Flying\nWhen this creature dies, return another target artifact card from your graveyard to your hand.",
    power: "1",
    toughness: "1",
});

const PEGASUS_COURSER = oracleCard({
    oracleId: "24db5905-d513-42c6-9e9d-114ac5cbd21d",
    name: "Pegasus Courser",
    manaCost: "{2}{W}",
    typeLine: "Creature — Pegasus",
    oracleText:
        "Flying\nWhenever this creature attacks, another target attacking creature gains flying until end of turn.",
    power: "1",
    toughness: "3",
});

const TRIBUTARY_VAULTER = oracleCard({
    oracleId: "991f4eec-cf3e-4554-ba88-c44bb0d255f0",
    name: "Tributary Vaulter",
    manaCost: "{2}{W}",
    typeLine: "Creature — Merfolk Warrior",
    oracleText:
        "Flying\nWhenever this creature becomes tapped, another target Merfolk you control gets +2/+0 until end of turn.",
    power: "1",
    toughness: "3",
});

const ICEFEATHER_AVEN = oracleCard({
    oracleId: "9fb901db-1ff7-4a8d-8233-fe7e3dee7fd1",
    name: "Icefeather Aven",
    manaCost: "{G}{U}",
    typeLine: "Creature — Bird Shaman",
    oracleText:
        "Flying\nMorph {1}{G}{U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nWhen this creature is turned face up, you may return another target creature to its owner's hand.",
    power: "2",
    toughness: "2",
});

const ARASHIN_FOREMOST = oracleCard({
    oracleId: "581c2fb6-fcce-42c1-b198-1f8d62e862b1",
    name: "Arashin Foremost",
    manaCost: "{1}{W}{W}",
    typeLine: "Creature — Human Warrior",
    oracleText:
        "Double strike\nWhenever this creature enters or attacks, another target Warrior creature you control gains double strike until end of turn.",
    power: "2",
    toughness: "2",
});

const FANG_OF_THE_PACK = oracleCard({
    oracleId: "ae8dffde-e59f-4f4f-8e7f-e7dc34f62e92",
    name: "Fang of the Pack",
    manaCost: "{5}{G}",
    typeLine: "Creature — Wolf",
    oracleText:
        "Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)\nAt the beginning of combat on your turn, another target creature you control gains melee until end of turn. (If a creature has multiple instances of melee, each triggers separately.)",
    power: "5",
    toughness: "3",
});

const WICCAN = oracleCard({
    oracleId: "fc17b7a3-7711-4449-80bd-692e8ed9087d",
    name: "Wiccan, Rising Magician",
    manaCost: "{4}{U}",
    typeLine: "Legendary Creature — Mutant Warlock Hero",
    oracleText:
        "Flying\nWhenever you cast a noncreature spell, exile another target nonland, nontoken permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
    power: "4",
    toughness: "4",
});

const AETHER_CHANNELER = oracleCard({
    oracleId: "fb220f46-f8b8-4804-baa4-e7d50b4871f7",
    name: "Aether Channeler",
    manaCost: "{2}{U}",
    typeLine: "Creature — Human Wizard",
    oracleText:
        "When this creature enters, choose one —\n• Create a 1/1 white Bird creature token with flying.\n• Return another target nonland permanent to its owner's hand.\n• Draw a card.",
    power: "2",
    toughness: "1",
});

const GOLDENS: readonly [string, OracleCard, unknown][] = [
    [
        'an enters head, the exiled card returned as "that card"',
        FLICKERWISP,
        {
            name: "Flickerwisp",
            types: ["Creature"],
            subtypes: ["Elemental"],
            manaCost: { X: 1, W: 2 },
            power: 3,
            toughness: 1,
            oracleText:
                "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "flickerwisp-trigger",
                    oracleText:
                        "When this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                        count: 1,
                        excludeSource: true,
                    },
                    effects: [
                        { op: "exile", target: { target: 0 }, bind: "$that1" },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                            capture: { $c: { ref: "$that1" } },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$c" },
                                    from: "exile",
                                    to: "battlefield",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a dies head naming a graveyard card",
        JUNK_DIVER,
        {
            name: "Junk Diver",
            types: ["Artifact", "Creature"],
            subtypes: ["Bird"],
            manaCost: { X: 3 },
            power: 1,
            toughness: 1,
            oracleText:
                "Flying\nWhen this creature dies, return another target artifact card from your graveyard to your hand.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "junk-diver-trigger",
                    oracleText:
                        "When this creature dies, return another target artifact card from your graveyard to your hand.",
                    head: { kind: "died", scope: "self" },
                    targetRequirement: {
                        type: "Artifact",
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                        excludeSource: true,
                    },
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "hand" },
                    ],
                },
            ],
        },
    ],
    [
        "an attacks head",
        PEGASUS_COURSER,
        {
            name: "Pegasus Courser",
            types: ["Creature"],
            subtypes: ["Pegasus"],
            manaCost: { X: 2, W: 1 },
            power: 1,
            toughness: 3,
            oracleText:
                "Flying\nWhenever this creature attacks, another target attacking creature gains flying until end of turn.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "pegasus-courser-trigger",
                    oracleText:
                        "Whenever this creature attacks, another target attacking creature gains flying until end of turn.",
                    head: { kind: "attacks" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        combatRoleFilter: ["attacking"],
                        excludeSource: true,
                    },
                    effects: [
                        {
                            op: "grantAbility",
                            target: { target: 0 },
                            ability: "flying",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a becomes-tapped head",
        TRIBUTARY_VAULTER,
        {
            name: "Tributary Vaulter",
            types: ["Creature"],
            subtypes: ["Merfolk", "Warrior"],
            manaCost: { X: 2, W: 1 },
            power: 1,
            toughness: 3,
            oracleText:
                "Flying\nWhenever this creature becomes tapped, another target Merfolk you control gets +2/+0 until end of turn.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "tributary-vaulter-trigger",
                    oracleText:
                        "Whenever this creature becomes tapped, another target Merfolk you control gets +2/+0 until end of turn.",
                    head: { kind: "tapped", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        subtypeFilter: ["Merfolk"],
                        controller: "you",
                        excludeSource: true,
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: 2,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        'a turned-face-up head behind "you may"',
        ICEFEATHER_AVEN,
        {
            name: "Icefeather Aven",
            types: ["Creature"],
            subtypes: ["Bird", "Shaman"],
            manaCost: { U: 1, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Flying\nMorph {1}{G}{U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nWhen this creature is turned face up, you may return another target creature to its owner's hand.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "icefeather-aven-trigger",
                    oracleText:
                        "When this creature is turned face up, you may return another target creature to its owner's hand.",
                    head: { kind: "turned-face-up" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        excludeSource: true,
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Return another target creature to its owner's hand?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
            morph: { X: 1, U: 1, G: 1 },
        },
    ],
    [
        "an enters-or-attacks head",
        ARASHIN_FOREMOST,
        {
            name: "Arashin Foremost",
            types: ["Creature"],
            subtypes: ["Human", "Warrior"],
            manaCost: { X: 1, W: 2 },
            power: 2,
            toughness: 2,
            oracleText:
                "Double strike\nWhenever this creature enters or attacks, another target Warrior creature you control gains double strike until end of turn.",
            staticAbilities: ["double strike"],
            compiledTriggeredAbilities: [
                {
                    id: "arashin-foremost-trigger",
                    oracleText:
                        "Whenever this creature enters or attacks, another target Warrior creature you control gains double strike until end of turn.",
                    head: { kind: "enters-or-attacks" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        subtypeFilter: ["Warrior"],
                        controller: "you",
                        excludeSource: true,
                    },
                    effects: [
                        {
                            op: "grantAbility",
                            target: { target: 0 },
                            ability: "double strike",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a beginning-of-combat head",
        FANG_OF_THE_PACK,
        {
            name: "Fang of the Pack",
            types: ["Creature"],
            subtypes: ["Wolf"],
            manaCost: { X: 5, G: 1 },
            power: 5,
            toughness: 3,
            oracleText:
                "Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)\nAt the beginning of combat on your turn, another target creature you control gains melee until end of turn. (If a creature has multiple instances of melee, each triggers separately.)",
            staticAbilities: ["melee"],
            compiledTriggeredAbilities: [
                {
                    id: "fang-of-the-pack-trigger",
                    oracleText:
                        "At the beginning of combat on your turn, another target creature you control gains melee until end of turn.",
                    head: {
                        kind: "phase",
                        phase: "BEGINNING_OF_COMBAT",
                        scope: "your",
                    },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                        excludeSource: true,
                    },
                    effects: [
                        {
                            op: "grantAbility",
                            target: { target: 0 },
                            ability: "melee",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a you-cast-a-spell head",
        WICCAN,
        {
            name: "Wiccan, Rising Magician",
            types: ["Creature"],
            supertypes: ["Legendary"],
            subtypes: ["Mutant", "Warlock", "Hero"],
            manaCost: { X: 4, U: 1 },
            power: 4,
            toughness: 4,
            oracleText:
                "Flying\nWhenever you cast a noncreature spell, exile another target nonland, nontoken permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "wiccan-rising-magician-trigger",
                    oracleText:
                        "Whenever you cast a noncreature spell, exile another target nonland, nontoken permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                    head: {
                        kind: "spell-cast",
                        scope: "you",
                        filter: { excludeTypes: ["Creature"] },
                    },
                    targetRequirement: {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                        count: 1,
                        excludeTypes: ["Land"],
                        isToken: false,
                        excludeSource: true,
                    },
                    effects: [
                        { op: "exile", target: { target: 0 }, bind: "$that1" },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                            capture: { $c: { ref: "$that1" } },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$c" },
                                    from: "exile",
                                    to: "battlefield",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a modal trigger's mode",
        AETHER_CHANNELER,
        {
            name: "Aether Channeler",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: { X: 2, U: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "When this creature enters, choose one —\n• Create a 1/1 white Bird creature token with flying.\n• Return another target nonland permanent to its owner's hand.\n• Draw a card.",
            compiledTriggeredAbilities: [
                {
                    id: "aether-channeler-trigger",
                    oracleText:
                        "When this creature enters, choose one —\n• Create a 1/1 white Bird creature token with flying.\n• Return another target nonland permanent to its owner's hand.\n• Draw a card.",
                    head: { kind: "entered", scope: "self" },
                    effects: [],
                    modes: [
                        {
                            id: "aether-channeler-trigger-mode-1",
                            label: "Create a 1/1 white Bird creature token with flying",
                            oracleText:
                                "Create a 1/1 white Bird creature token with flying.",
                            effects: [
                                {
                                    op: "createToken",
                                    token: {
                                        name: "Bird",
                                        types: ["Creature"],
                                        subtypes: ["Bird"],
                                        power: 1,
                                        toughness: 1,
                                        colors: ["W"],
                                        staticAbilities: ["flying"],
                                    },
                                    controller: "controller",
                                },
                            ],
                        },
                        {
                            id: "aether-channeler-trigger-mode-2",
                            label: "Return another target nonland permanent to its owner's hand",
                            oracleText:
                                "Return another target nonland permanent to its owner's hand.",
                            targetRequirement: {
                                type: [
                                    "Artifact",
                                    "Battle",
                                    "Creature",
                                    "Enchantment",
                                    "Land",
                                    "Planeswalker",
                                ],
                                count: 1,
                                excludeTypes: ["Land"],
                                excludeSource: true,
                            },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "hand",
                                },
                            ],
                        },
                        {
                            id: "aether-channeler-trigger-mode-3",
                            label: "Draw a card",
                            oracleText: "Draw a card.",
                            effects: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
];

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function refusalReasons(name: string, oracleText: string): string {
    const outcome = compileCard(oracleCard({ name, oracleText }));
    if (outcome.state !== "unparsed")
        throw new Error(`"${oracleText}" compiled: ${outcome.state}`);
    return outcome.gaps.map((g) => g.reason).join("; ");
}

describe('"another target" on a trigger — golden fixtures (CR 603.3d)', () => {
    it.each(GOLDENS)("%s", (_form, card, expected) => {
        expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
    });
});

describe('"another target" on a trigger — refusals (CR 603.3d)', () => {
    it.each([
        [
            "an Aura's host",
            "When enchanted creature dies, another target creature gets +1/+1 until end of turn.",
        ],
        [
            "any creature entering",
            "Whenever a creature enters, another target creature gets +1/+1 until end of turn.",
        ],
        [
            "another creature entering",
            "Whenever another creature you control enters, another target creature gets +1/+1 until end of turn.",
        ],
        [
            "a creature dying",
            "Whenever a creature dies, another target creature gets +1/+1 until end of turn.",
        ],
    ])("refuses behind a head naming %s", (_head, oracleText) => {
        expect(refusalReasons("Head Probe", oracleText)).toMatch(
            /names no earlier target/
        );
    });

    it('refuses "it" returned behind a head naming the source (CR 608.2h)', () => {
        // "that card" cannot be the permanent the head named; "it" can.
        expect(
            refusalReasons(
                "Pronoun Probe",
                "When this creature enters, exile another target permanent. Return it to the battlefield under its owner's control at the beginning of the next end step."
            )
        ).toMatch(/names no single object announced/);
    });

    it('refuses "that card" returned to a hand behind the same head (CR 608.2h)', () => {
        // The carve-out is the exile's card coming back, nothing wider.
        expect(
            refusalReasons(
                "Hand Probe",
                "When this creature enters, tap another target creature. Return that card to its owner's hand at the beginning of the next end step."
            )
        ).toMatch(/names no single object announced/);
    });
});

function withCompiled<T>(card: OracleCard, fn: (id: string) => T): T {
    const id = `test-8449-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
    const definition = expandCompiledTriggers({
        ...compiled(card),
        id,
        rarity: "common",
    } as unknown as CardDefinition);
    return withTemporaryDefinition(definition, () => fn(id));
}

/** Junk Diver on p1's battlefield with `others` in p1's graveyard, destroyed:
 *  its dies trigger is on the stack, collected from the real event. */
function diverDied(id: string, others: readonly string[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(id, {
                        id: "diver",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                graveyard: others.map((other) =>
                    makeInstance(id, {
                        id: other,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    expect(destroyWithReplacements(state, "diver")).toBe(true);
    const triggers = collectTriggers(state, state.pendingEvents ?? []);
    expect(triggers.map((t) => t.triggeredAbilityId)).toEqual([
        "junk-diver-trigger",
    ]);
    state.stack.push(...triggers);
    return state;
}

describe('"another target" on a dies trigger — the source in its graveyard (CR 603.3d)', () => {
    it("with no other card, the source is no legal choice and the ability is removed", () => {
        withCompiled(JUNK_DIVER, (id) => {
            const state = diverDied(id, []);
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack).toEqual([]);
        });
    });

    it("with one other card, the sole legal target is that card, never the source", () => {
        withCompiled(JUNK_DIVER, (id) => {
            const state = diverDied(id, ["other"]);
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack[0]!.targets?.map((t) => t.id)).toEqual([
                "other",
            ]);
        });
    });
});

/** `card` on p1's battlefield beside one opposing permanent, its enters trigger
 *  on the stack (with `chosenModeIds` when the trigger is modal). */
function enteredWithOneOther(
    id: string,
    abilityId: string,
    chosenModeIds?: string[]
): GameState {
    const source = makeInstance(id, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(id, {
                        id: "other",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.stack.push({
        ...buildTriggerItem(state, source, abilityId, []),
        ...(chosenModeIds !== undefined ? { chosenModeIds } : {}),
    });
    return state;
}

describe('"another target" on an enters trigger — the source on the battlefield (CR 603.3d)', () => {
    it("the only legal target of Flickerwisp's trigger is the other permanent", () => {
        withCompiled(FLICKERWISP, (id) => {
            const state = enteredWithOneOther(id, "flickerwisp-trigger");
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack[0]!.targets?.map((t) => t.id)).toEqual([
                "other",
            ]);
        });
    });

    it("the only legal target of a modal trigger's chosen mode is the other permanent", () => {
        withCompiled(AETHER_CHANNELER, (id) => {
            const state = enteredWithOneOther(id, "aether-channeler-trigger", [
                "aether-channeler-trigger-mode-2",
            ]);
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack[0]!.targets?.map((t) => t.id)).toEqual([
                "other",
            ]);
        });
    });
});
