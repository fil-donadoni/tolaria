// Subtype lists (CR 205.3) and the rule family around them (issue #10344):
// the serial list before "card", the counted "and" / "and/or" list, "other" in
// a counted set, counters per counted set, a sweep that entered this turn, a
// keyword of your choice, and Affinity for a subtype.
//
//  1. GOLDEN — a real corpus card compiled whole, equal to the full Compiled
//     Definition, one per accepted form.
//  2. LINE — the forms whose only printers still carry a gap of another
//     cluster: the sub-grammar's whole output, and the card's remaining gaps
//     naming none of the lines read here.
//  3. REFUSALS — the neighbours that must stay unread.
//  4. SUB-GRAMMAR — `readSubtypeList` itself.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { affinityRule } from "../grammar/slots/keywordLine";
import { amongPickRule } from "../grammar/shared/fromAmong";
import { massSubjectRule } from "../grammar/shared/massSubject";
import { countedSetRule, numberOfSetRule } from "../grammar/shared/quantity";
import { readSubtypeList } from "../grammar/shared/subtypeList";
import {
    descriptorRule,
    targetFilterRule,
} from "../grammar/shared/targetFilter";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

const GOLDENS: readonly [form: string, card: OracleCard, expected: object][] = [
    [
        'a serial subtype list before "card", picked from among (CR 205.3)',
        {
            oracleId: "48c641df-d511-4e35-b623-9d1fdb5240da",
            name: "Eclipsed Flamekin",
            manaCost: "{1}{U/R}{U/R}",
            typeLine: "Creature — Elemental Scout",
            oracleText:
                "When this creature enters, look at the top four cards of your library. You may reveal an Elemental, Island, or Mountain card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
            layout: "normal",
            power: "1",
            toughness: "4",
        },
        {
            name: "Eclipsed Flamekin",
            types: ["Creature"],
            subtypes: ["Elemental", "Scout"],
            manaCost: {
                X: 1,
                hybrid: [
                    ["U", "R"],
                    ["U", "R"],
                ],
            },
            power: 1,
            toughness: 4,
            oracleText:
                "When this creature enters, look at the top four cards of your library. You may reveal an Elemental, Island, or Mountain card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
            compiledTriggeredAbilities: [
                {
                    id: "eclipsed-flamekin-trigger",
                    oracleText:
                        "When this creature enters, look at the top four cards of your library. You may reveal an Elemental, Island, or Mountain card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "lookDistribute",
                            keepTo: "hand",
                            player: "controller",
                            look: 4,
                            take: 1,
                            filter: {
                                subtype: ["Elemental", "Island", "Mountain"],
                            },
                            optional: true,
                            reveal: "kept",
                            randomBottom: true,
                        },
                    ],
                },
            ],
        },
    ],
    [
        'a serial subtype list before "card", searched for (CR 701.23a)',
        {
            oracleId: "0a1d817d-dce8-4e83-a380-909f7c9eee46",
            name: "Bant Panorama",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "{T}: Add {C}.\n{1}, {T}, Sacrifice this land: Search your library for a basic Forest, Plains, or Island card, put it onto the battlefield tapped, then shuffle.",
            layout: "normal",
        },
        {
            name: "Bant Panorama",
            types: ["Land"],
            oracleText:
                "{T}: Add {C}.\n{1}, {T}, Sacrifice this land: Search your library for a basic Forest, Plains, or Island card, put it onto the battlefield tapped, then shuffle.",
            activatedAbilities: [
                {
                    id: "bant-panorama-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "bant-panorama-ability-2",
                    oracleText:
                        "{1}, {T}, Sacrifice this land: Search your library for a basic Forest, Plains, or Island card, put it onto the battlefield tapped, then shuffle.",
                    cost: { mana: { X: 1 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: {
                                subtype: ["Forest", "Plains", "Island"],
                                supertype: "Basic",
                            },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a basic Forest, Plains, or Island card.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "battlefield",
                            tapped: true,
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        },
    ],
    [
        'an "and" list of other subtypes, counted (CR 205.3, CR 201.5)',
        {
            oracleId: "8da0599a-8f63-4dba-857f-b4e10b7191b6",
            name: "Valley Rotcaller",
            manaCost: "{1}{B}",
            typeLine: "Creature — Squirrel Warlock",
            oracleText:
                "Menace\nWhenever this creature attacks, each opponent loses X life and you gain X life, where X is the number of other Squirrels, Bats, Lizards, and Rats you control.",
            layout: "normal",
            power: "1",
            toughness: "3",
        },
        {
            name: "Valley Rotcaller",
            types: ["Creature"],
            subtypes: ["Squirrel", "Warlock"],
            manaCost: { X: 1, B: 1 },
            power: 1,
            toughness: 3,
            oracleText:
                "Menace\nWhenever this creature attacks, each opponent loses X life and you gain X life, where X is the number of other Squirrels, Bats, Lizards, and Rats you control.",
            staticAbilities: ["menace"],
            compiledTriggeredAbilities: [
                {
                    id: "valley-rotcaller-trigger",
                    oracleText:
                        "Whenever this creature attacks, each opponent loses X life and you gain X life, where X is the number of other Squirrels, Bats, Lizards, and Rats you control.",
                    head: { kind: "attacks" },
                    effects: [
                        {
                            op: "loseLife",
                            player: "opponent",
                            amount: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        subtype: [
                                            "Squirrel",
                                            "Bat",
                                            "Lizard",
                                            "Rat",
                                        ],
                                        excludeSource: true,
                                    },
                                },
                            },
                        },
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        subtype: [
                                            "Squirrel",
                                            "Bat",
                                            "Lizard",
                                            "Rat",
                                        ],
                                        excludeSource: true,
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    [
        '"other" in a counted set, scaled (CR 201.5)',
        {
            oracleId: "6fe35d1f-20b6-4fa8-a318-79e2d415701a",
            name: "Goldnight Redeemer",
            manaCost: "{4}{W}{W}",
            typeLine: "Creature — Angel",
            oracleText:
                "Flying\nWhen this creature enters, you gain 2 life for each other creature you control.",
            layout: "normal",
            power: "4",
            toughness: "4",
        },
        {
            name: "Goldnight Redeemer",
            types: ["Creature"],
            subtypes: ["Angel"],
            manaCost: { X: 4, W: 2 },
            power: 4,
            toughness: 4,
            oracleText:
                "Flying\nWhen this creature enters, you gain 2 life for each other creature you control.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "goldnight-redeemer-trigger",
                    oracleText:
                        "When this creature enters, you gain 2 life for each other creature you control.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        type: ["Creature"],
                                        excludeSource: true,
                                    },
                                    times: 2,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "counters per counted set on a target (CR 122.1)",
        {
            oracleId: "e6e38bd4-e6dc-400b-8e08-956726842dc4",
            name: "Immaculate Magistrate",
            manaCost: "{3}{G}",
            typeLine: "Creature — Elf Shaman",
            oracleText:
                "{T}: Put a +1/+1 counter on target creature for each Elf you control.",
            layout: "normal",
            power: "2",
            toughness: "2",
        },
        {
            name: "Immaculate Magistrate",
            types: ["Creature"],
            subtypes: ["Elf", "Shaman"],
            manaCost: { X: 3, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "{T}: Put a +1/+1 counter on target creature for each Elf you control.",
            activatedAbilities: [
                {
                    id: "immaculate-magistrate-ability",
                    oracleText:
                        "{T}: Put a +1/+1 counter on target creature for each Elf you control.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { target: 0 },
                            count: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: { subtype: "Elf" },
                                },
                            },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        },
    ],
    [
        "counters per counted set on the source (CR 122.1)",
        {
            oracleId: "48edac92-0dd8-4274-bf1b-122243770540",
            name: "Moldgraf Millipede",
            manaCost: "{4}{G}",
            typeLine: "Creature — Insect Horror",
            oracleText:
                "When this creature enters, mill three cards, then put a +1/+1 counter on this creature for each creature card in your graveyard. (To mill three cards, put the top three cards of your library into your graveyard.)",
            layout: "normal",
            power: "2",
            toughness: "2",
        },
        {
            name: "Moldgraf Millipede",
            types: ["Creature"],
            subtypes: ["Insect", "Horror"],
            manaCost: { X: 4, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "When this creature enters, mill three cards, then put a +1/+1 counter on this creature for each creature card in your graveyard. (To mill three cards, put the top three cards of your library into your graveyard.)",
            compiledTriggeredAbilities: [
                {
                    id: "moldgraf-millipede-trigger",
                    oracleText:
                        "When this creature enters, mill three cards, then put a +1/+1 counter on this creature for each creature card in your graveyard.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        { op: "mill", player: "controller", count: 3 },
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: {
                                count: {
                                    zone: "graveyard",
                                    controller: "controller",
                                    filter: { type: ["Creature"] },
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "X counters where X is a counted set (CR 107.3)",
        {
            oracleId: "bd0e22d1-4789-406d-9293-3ade30365b32",
            name: "Strength Bobblehead",
            manaCost: "{3}",
            typeLine: "Artifact — Bobblehead",
            oracleText:
                "{T}: Add one mana of any color.\n{3}, {T}: Put X +1/+1 counters on target creature, where X is the number of Bobbleheads you control. Activate only as a sorcery.",
            layout: "normal",
        },
        {
            name: "Strength Bobblehead",
            types: ["Artifact"],
            subtypes: ["Bobblehead"],
            manaCost: { X: 3 },
            oracleText:
                "{T}: Add one mana of any color.\n{3}, {T}: Put X +1/+1 counters on target creature, where X is the number of Bobbleheads you control. Activate only as a sorcery.",
            activatedAbilities: [
                {
                    id: "strength-bobblehead-mana",
                    oracleText: "{T}: Add one mana of any color.",
                    cost: { tap: true },
                    useStack: false,
                    manaChoices: [
                        { W: 1 },
                        { U: 1 },
                        { B: 1 },
                        { R: 1 },
                        { G: 1 },
                    ],
                },
                {
                    id: "strength-bobblehead-ability-2",
                    oracleText:
                        "{3}, {T}: Put X +1/+1 counters on target creature, where X is the number of Bobbleheads you control. Activate only as a sorcery.",
                    cost: { mana: { X: 3 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { target: 0 },
                            count: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: { subtype: "Bobblehead" },
                                },
                            },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                    sorcerySpeedOnly: true,
                },
            ],
        },
    ],
    [
        "a choice of two keywords on a target (CR 608.2d)",
        {
            oracleId: "b254ca74-2a96-4590-91bc-650f407daf5d",
            name: "Manifold Mouse",
            manaCost: "{1}{R}",
            typeLine: "Creature — Mouse Soldier",
            oracleText:
                "Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nAt the beginning of combat on your turn, target Mouse you control gains your choice of double strike or trample until end of turn.",
            layout: "normal",
            power: "1",
            toughness: "2",
        },
        {
            name: "Manifold Mouse",
            types: ["Creature"],
            subtypes: ["Mouse", "Soldier"],
            manaCost: { X: 1, R: 1 },
            power: 1,
            toughness: 2,
            oracleText:
                "Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nAt the beginning of combat on your turn, target Mouse you control gains your choice of double strike or trample until end of turn.",
            compiledTriggeredAbilities: [
                {
                    id: "offspring-token-copy-offspring",
                    oracleText:
                        "When Manifold Mouse enters, if its offspring cost was paid, create a token that's a copy of it, except it's 1/1.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "offspring" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "offspring" },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "createTokenCopy",
                                    source: { ref: "$source" },
                                    controller: "controller",
                                    except: { basePower: 1, baseToughness: 1 },
                                },
                            ],
                        },
                    ],
                    additionalCostTwin: {
                        keyword: "offspring",
                        costId: "offspring",
                    },
                },
                {
                    id: "manifold-mouse-trigger-2",
                    oracleText:
                        "At the beginning of combat on your turn, target Mouse you control gains your choice of double strike or trample until end of turn.",
                    head: {
                        kind: "phase",
                        phase: "BEGINNING_OF_COMBAT",
                        scope: "your",
                    },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        subtypeFilter: ["Mouse"],
                        controller: "you",
                    },
                    effects: [
                        {
                            op: "optionChoice",
                            prompt: "Choose an ability (Manifold Mouse).",
                            modes: [
                                {
                                    id: "double-strike",
                                    label: "Double strike",
                                    effects: [
                                        {
                                            op: "grantAbility",
                                            target: { target: 0 },
                                            ability: "double strike",
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                                {
                                    id: "trample",
                                    label: "Trample",
                                    effects: [
                                        {
                                            op: "grantAbility",
                                            target: { target: 0 },
                                            ability: "trample",
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "offspring",
                    keyword: "offspring",
                    description: "Offspring {2}",
                    mana: { X: 2 },
                },
            ],
        },
    ],
    [
        "affinity for a creature subtype (CR 702.41a)",
        {
            oracleId: "499d76c1-97ff-4006-922c-be1684a7754c",
            name: "Claws Out",
            manaCost: "{3}{W}{W}",
            typeLine: "Instant",
            oracleText:
                "Affinity for Cats (This spell costs {1} less to cast for each Cat you control.)\nCreatures you control get +2/+2 until end of turn.",
            layout: "normal",
        },
        {
            name: "Claws Out",
            types: ["Instant"],
            manaCost: { X: 3, W: 2 },
            oracleText:
                "Affinity for Cats (This spell costs {1} less to cast for each Cat you control.)\nCreatures you control get +2/+2 until end of turn.",
            staticAbilities: ["affinity for cats"],
            selfCostReduction: {
                costReduction: {
                    perCount: { X: 1 },
                    countFilter: { subtypes: "Cat" },
                },
            },
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "affinity for a land subtype (CR 702.41a)",
        {
            oracleId: "bfdc6bbc-7402-40ae-91be-658afca2f145",
            name: "Spire Golem",
            manaCost: "{6}",
            typeLine: "Artifact Creature — Golem",
            oracleText:
                "Affinity for Islands (This spell costs {1} less to cast for each Island you control.)\nFlying",
            layout: "normal",
            power: "2",
            toughness: "4",
        },
        {
            name: "Spire Golem",
            types: ["Artifact", "Creature"],
            subtypes: ["Golem"],
            manaCost: { X: 6 },
            power: 2,
            toughness: 4,
            oracleText:
                "Affinity for Islands (This spell costs {1} less to cast for each Island you control.)\nFlying",
            staticAbilities: ["affinity for islands", "flying"],
            selfCostReduction: {
                costReduction: {
                    perCount: { X: 1 },
                    countFilter: { subtypes: "Island" },
                },
            },
        },
    ],
];

/** The lines a refused card still prints unread. */
function unreadLines(card: OracleCard): string[] {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(
            `${card.name}: expected a refusal, got ${outcome.state}`
        );
    return outcome.gaps.map((gap) => gap.line ?? gap.fragment);
}

function spell(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

describe("subtype lists — golden fixtures", () => {
    it.each(GOLDENS)("%s", (_form, card, expected) => {
        const outcome = compileCard(card);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
    });

    it.each([
        "Shifting Ceratops",
        "Raucous Entertainer",
        "Butcher of the Horde",
        "Assassin Initiate",
        "Lunar Avenger",
        "Ezrim, Agency Chief",
        "Novijen, Heart of Progress",
        "Oran-Rief, the Vastwood",
    ])("%s compiles to its registered fixture", (name) => {
        const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name)!;
        const outcome = compileCard(fixture.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
    });
});

describe("subtype lists — lines whose printer has another gap", () => {
    const MUDFLAT_LINE =
        "{1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand.";
    const DREYLEADER_LINE =
        "When this creature enters, put a +1/+1 counter on it for each other Squirrel and/or Food you control.";
    const OAKHOLLOW_LINE =
        "{G}, {T}: Put a +1/+1 counter on each Frog, Rabbit, Raccoon, or Squirrel you control that entered the battlefield this turn.";
    const LUPINFLOWER_LINE =
        "{1}{W}, {T}, Sacrifice this land: Look at the top six cards of your library. You may reveal a Bat, Bird, Mouse, or Rabbit card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";

    it("a graveyard target takes the serial list (Mudflat Village, CR 115.1)", () => {
        const parsed = targetFilterRule.run(
            "target Bat, Lizard, Rat, or Squirrel card from your graveyard",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            type: "card",
            count: 1,
            subtypeFilter: ["Bat", "Lizard", "Rat", "Squirrel"],
            zone: "graveyard",
            controller: "you",
        });
    });

    it("a from-among pick takes the four-way list (Lupinflower Village)", () => {
        const parsed = amongPickRule.run(
            "a Bat, Bird, Mouse, or Rabbit card from among them",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            filter: { subtype: ["Bat", "Bird", "Mouse", "Rabbit"] },
            card: "a Bat, Bird, Mouse, or Rabbit card",
        });
    });

    it('"for each other Squirrel and/or Food" counts the union (Honored Dreyleader)', () => {
        const parsed = countedSetRule.run(
            "for each other Squirrel and/or Food you control",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            kind: "permanents",
            descriptor: {
                subtypes: ["Squirrel", "Food"],
                subtypeUnion: true,
                controller: "you",
                excludeSource: true,
            },
        });
    });

    it('"the number of … and/or …" counts the plural union (CR 107.1)', () => {
        const parsed = numberOfSetRule.run(
            "the number of Crabs, Oozes, and/or Horrors you control",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            kind: "permanents",
            descriptor: {
                subtypes: ["Crab", "Ooze", "Horror"],
                subtypeUnion: true,
                controller: "you",
                plural: true,
            },
        });
    });

    it("a sweep takes the list and the entry clause (Oakhollow Village, CR 400.7)", () => {
        const parsed = massSubjectRule.run(
            "each Frog, Rabbit, Raccoon, or Squirrel you control that entered the battlefield this turn",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: {
                    subtype: ["Frog", "Rabbit", "Raccoon", "Squirrel"],
                    enteredThisTurn: true,
                },
            },
            manaValueAtMostX: false,
        });
    });

    it.each([
        [
            "Mudflat Village",
            `{T}: Add {C}.\n{T}: Add {B}. Spend this mana only to cast a creature spell.\n${MUDFLAT_LINE}`,
            MUDFLAT_LINE,
        ],
        [
            "Oakhollow Village",
            `{T}: Add {C}.\n{T}: Add {G}. Spend this mana only to cast a creature spell.\n${OAKHOLLOW_LINE}`,
            OAKHOLLOW_LINE,
        ],
        [
            "Lupinflower Village",
            `{T}: Add {C}.\n{T}: Add {W}. Spend this mana only to cast a creature spell.\n${LUPINFLOWER_LINE}`,
            LUPINFLOWER_LINE,
        ],
    ])("%s's line compiles alone", (name, oracleText, line) => {
        const land = { name, typeLine: "Land", manaCost: "" };
        const bare = { power: undefined, toughness: undefined };
        // The whole card may still carry another cluster's gap; this line is
        // none of it.
        const whole = compileCard(oracleCard({ ...land, ...bare, oracleText }));
        if (whole.state === "unparsed")
            expect(whole.gaps.map((g) => g.line ?? g.fragment)).not.toContain(
                line
            );
        const alone = compileCard(
            oracleCard({ ...land, ...bare, oracleText: line })
        );
        expect(alone.state).not.toBe("unparsed");
    });

    it("Honored Dreyleader's enters line puts one counter per other member", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Honored Dreyleader",
                manaCost: "{2}{G}",
                typeLine: "Creature — Squirrel Warrior",
                oracleText: DREYLEADER_LINE,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(
            outcome.definition.compiledTriggeredAbilities![0]!.effects
        ).toEqual([
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { ref: "$source" },
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: {
                            subtype: ["Squirrel", "Food"],
                            excludeSource: true,
                        },
                    },
                },
            },
        ]);
    });

    it.each([
        ["Affinity for Frogs", "Frogs", "Frog"],
        ["Affinity for Lizards", "Lizards", "Lizard"],
    ])("%s reads the subtype (CR 702.41a)", (line, quality, subtype) => {
        const parsed = affinityRule.run(line, parseContext());
        expect(parsed.ok && parsed.value).toEqual({
            kind: "affinity",
            quality,
            subtype,
        });
    });
});

describe("subtype lists — refused neighbours", () => {
    it.each([
        "Affinity for artifacts",
        "Affinity for artifact creatures",
        "Affinity for creatures",
        "Affinity for outlaws",
        "Affinity for tokens",
        "Affinity for snow lands",
        "Affinity for Elves",
        "Affinity for Equipment",
        "Affinity for Frog",
        "Affinity for Frogs you control",
    ])("%s", (line) => {
        expect(affinityRule.run(line, parseContext()).ok).toBe(false);
    });

    it("a second self cost reduction is refused, not overwritten (CR 702.41b)", () => {
        expect(
            compileCard(
                spell(
                    "Twice Affine",
                    "{6}{W}",
                    "Affinity for Cats\nAffinity for Towns\nCreatures you control get +2/+2 until end of turn."
                )
            ).state
        ).toBe("unparsed");
    });

    it.each([
        // A planeswalker type (Harald, King of Skemfar) is in no table here.
        "an Elf, Warrior, or Tyvar card from among them",
        // Stacked subtypes are an intersection.
        "an Elf Warrior card from among them",
        // A card type beside a subtype is a union of two dimensions.
        "an Elf, Warrior, or land card from among them",
        // A plural list is another pick count.
        "a Bats, Birds, or Mice card from among them",
    ])("%s", (span) => {
        expect(amongPickRule.run(span, parseContext()).ok).toBe(false);
    });

    it.each([
        // "and" joins plurals; a singular one is the sweep's own.
        "for each Squirrel and Food you control",
        // No serial comma.
        "for each Squirrel, Bat and/or Food you control",
        "for each Squirrel and/or land you control",
        "for each Squirrel and/or Squirrel you control",
    ])("%s", (span) => {
        expect(countedSetRule.run(span, parseContext()).ok).toBe(false);
    });

    it.each([
        "Squirrels and Bats you control",
        "Squirrel and/or Food you control",
    ])("only a counted set reads the union: %s", (span) => {
        expect(descriptorRule.run(span, parseContext()).ok).toBe(false);
    });

    it('a targeted opponent\'s board takes no union ("target opponent controls")', () => {
        expect(
            numberOfSetRule.run(
                "the number of Squirrels and Bats target opponent controls",
                parseContext()
            ).ok
        ).toBe(false);
    });

    it("stacked subtypes are no union in a count (CR 205.3)", () => {
        expect(
            compileCard(
                spell(
                    "Stacked Count",
                    "{G}",
                    "You gain 1 life for each Elf Warrior you control."
                )
            ).state
        ).toBe("unparsed");
    });

    it.each([
        // A put on an unqualified sweep is another cluster's form.
        "Put a +1/+1 counter on each creature you control.",
        // A different history: whose control it entered under.
        "Put a +1/+1 counter on each creature that entered the battlefield under your control this turn.",
        // A printed-number loss for each opponent is another family.
        "Each opponent loses 2 life and you gain 2 life.",
        // Parameterised keyword (Jodah's Avenger's list).
        "Target creature gains your choice of double strike, protection from red, or vigilance until end of turn.",
        // Pump beside the choice (Alchemist's Gift).
        "Target creature gets +1/+1 and gains your choice of deathtouch or lifelink until end of turn.",
        // One pick for several objects.
        "Two target creatures each gains your choice of flying or trample until end of turn.",
        "Target creature gains your choice of flying until end of turn.",
        "Target creature gains your choice of flying or flying until end of turn.",
    ])("%s", (line) => {
        expect(compileCard(spell("Refused", "{1}{G}", line)).state).toBe(
            "unparsed"
        );
    });

    it("Finneas, Ace Archer's token-or-Rabbit sweep stays refused", () => {
        const line =
            "Whenever Finneas attacks, put a +1/+1 counter on each other creature you control that's a token or a Rabbit. Then if creatures you control have total power 10 or greater, draw a card.";
        expect(
            unreadLines(
                oracleCard({
                    name: "Finneas, Ace Archer",
                    manaCost: "{G}{W}",
                    typeLine: "Legendary Creature — Rabbit Archer",
                    oracleText: `Reach, vigilance\n${line}`,
                })
            )
        ).toHaveLength(1);
    });

    it("Muerra, Trash Tactician's per-Raccoon colour pick stays refused", () => {
        const line =
            "At the beginning of your first main phase, add {R} or {G} for each Raccoon you control.";
        expect(
            unreadLines(
                oracleCard({
                    name: "Muerra, Trash Tactician",
                    manaCost: "{1}{R}{G}",
                    typeLine: "Legendary Creature — Raccoon Warrior",
                    oracleText: line,
                })
            )
        ).toEqual([line]);
    });
});

describe("readSubtypeList (CR 205.3)", () => {
    it.each([
        ["Squirrel and/or Food", ["Squirrel", "Food"], "and/or", "singular"],
        [
            "Squirrels, Bats, Lizards, and Rats",
            ["Squirrel", "Bat", "Lizard", "Rat"],
            "and",
            "plural",
        ],
        [
            "Bat, Bird, Mouse, or Rabbit",
            ["Bat", "Bird", "Mouse", "Rabbit"],
            "or",
            "singular",
        ],
    ])("%s", (phrase, subtypes, conjunction, number) => {
        expect(readSubtypeList(phrase)).toEqual({
            subtypes,
            conjunction,
            number,
        });
    });

    it.each([
        "Squirrel",
        "Squirrel and Bats",
        "Squirrel, Bat, Rat",
        "Squirrel, Bat or Rat",
        "Squirrel or land",
        "Elf Warrior or Bat",
        "Bat, Bird, or Bat",
        "Wolves and Elves",
    ])("refuses %s", (phrase) => {
        expect(readSubtypeList(phrase)).toBeNull();
    });
});
