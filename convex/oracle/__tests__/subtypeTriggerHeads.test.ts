// Subtype-narrowed trigger heads — "whenever another [nontoken] <subtypes> you
// control enters", "whenever you cast a <creature type> spell", "whenever you
// cast a noncreature or <creature type> spell", "whenever a <subtype> is put
// into a graveyard from the battlefield" (issue #10345).
//
//  1. GOLDENS — every accepted form on a real corpus card, compiled whole and
//     compared with `sortKeys` equality. Honored Dreyleader is also a
//     `GOLDEN_FIXTURES` row: the canned smoke scenario cannot seed the
//     subtypes its enters trigger counts.
//  2. HEAD GOLDENS — the two forms whose only corpus cards are refused by
//     another clause (Harnesser of Storms, Ygra, Eater of All): the head rule
//     alone, on the printed span.
//  3. REFUSALS — the neighbouring heads the rule must NOT read, each behind a
//     body the accepted heads compile, so the refusal is the head's own.
//
// The engine half (does the rebuilt ability FIRE on the right permanent?) is
// `gre/__tests__/compiledSubtypeTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { triggerHeadRule } from "../grammar/shared/triggerHead";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

const GOLDENS: readonly (readonly [string, OracleCard, object])[] = [
    [
        "another <serial subtype list> you control enters (CR 603.6a, 205.3)",
        {
            name: "Valley Mightcaller",
            manaCost: "{G}",
            typeLine: "Creature — Frog Warrior",
            oracleText:
                "Trample\nWhenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.",
            power: "1",
            toughness: "1",
            oracleId: "16e9c452-6288-4da8-813d-2eb6b7a538c3",
            layout: "normal",
        },
        {
            name: "Valley Mightcaller",
            types: ["Creature"],
            subtypes: ["Frog", "Warrior"],
            manaCost: { G: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Trample\nWhenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "valley-mightcaller-trigger",
                    oracleText:
                        "Whenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.",
                    head: {
                        kind: "entered",
                        scope: "another-yours",
                        filter: {
                            subtypes: ["Frog", "Rabbit", "Raccoon", "Squirrel"],
                        },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
    [
        "another <subtype or artifact subtype> you control enters (CR 603.6a, 205.3)",
        {
            name: "Honored Dreyleader",
            manaCost: "{2}{G}",
            typeLine: "Creature — Squirrel Warrior",
            oracleText:
                "Trample\nWhen this creature enters, put a +1/+1 counter on it for each other Squirrel and/or Food you control.\nWhenever another Squirrel or Food you control enters, put a +1/+1 counter on this creature.",
            power: "1",
            toughness: "1",
            oracleId: "44bffa3e-4d31-4f9b-829c-e2066ab2f641",
            layout: "normal",
        },
        {
            name: "Honored Dreyleader",
            types: ["Creature"],
            subtypes: ["Squirrel", "Warrior"],
            manaCost: { X: 2, G: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Trample\nWhen this creature enters, put a +1/+1 counter on it for each other Squirrel and/or Food you control.\nWhenever another Squirrel or Food you control enters, put a +1/+1 counter on this creature.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "honored-dreyleader-trigger",
                    oracleText:
                        "When this creature enters, put a +1/+1 counter on it for each other Squirrel and/or Food you control.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
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
                    ],
                },
                {
                    id: "honored-dreyleader-trigger-2",
                    oracleText:
                        "Whenever another Squirrel or Food you control enters, put a +1/+1 counter on this creature.",
                    head: {
                        kind: "entered",
                        scope: "another-yours",
                        filter: { subtypes: ["Squirrel", "Food"] },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
    [
        "another nontoken <subtype> you control enters (CR 603.6a, 111.1)",
        {
            name: "Knightfisher",
            manaCost: "{3}{U}{U}",
            typeLine: "Creature — Bird Knight",
            oracleText:
                "Flying\nWhenever another nontoken Bird you control enters, create a 1/1 blue Fish creature token.",
            power: "4",
            toughness: "5",
            oracleId: "cb2d222c-df42-41a7-a517-0a41e47a4280",
            layout: "normal",
        },
        {
            name: "Knightfisher",
            types: ["Creature"],
            subtypes: ["Bird", "Knight"],
            manaCost: { X: 3, U: 2 },
            power: 4,
            toughness: 5,
            oracleText:
                "Flying\nWhenever another nontoken Bird you control enters, create a 1/1 blue Fish creature token.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "knightfisher-trigger",
                    oracleText:
                        "Whenever another nontoken Bird you control enters, create a 1/1 blue Fish creature token.",
                    head: {
                        kind: "entered",
                        scope: "another-yours",
                        filter: { subtypes: ["Bird"], isToken: false },
                    },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Fish",
                                types: ["Creature"],
                                subtypes: ["Fish"],
                                power: 1,
                                toughness: 1,
                                colors: ["U"],
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        },
    ],
    [
        "you cast a <creature type> spell (CR 603.2, 205.3m)",
        {
            name: "Lys Alana Huntmaster",
            manaCost: "{2}{G}{G}",
            typeLine: "Creature — Elf Warrior",
            oracleText:
                "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token.",
            power: "3",
            toughness: "3",
            oracleId: "3f3439e1-75ce-482d-881f-836492dca6e9",
            layout: "normal",
        },
        {
            name: "Lys Alana Huntmaster",
            types: ["Creature"],
            subtypes: ["Elf", "Warrior"],
            manaCost: { X: 2, G: 2 },
            power: 3,
            toughness: 3,
            oracleText:
                "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token.",
            compiledTriggeredAbilities: [
                {
                    id: "lys-alana-huntmaster-trigger",
                    oracleText:
                        "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token.",
                    head: {
                        kind: "spell-cast",
                        scope: "you",
                        filter: { subtypes: ["Elf"] },
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Create a 1/1 green Elf Warrior creature token?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "createToken",
                                    token: {
                                        name: "Elf Warrior",
                                        types: ["Creature"],
                                        subtypes: ["Elf", "Warrior"],
                                        power: 1,
                                        toughness: 1,
                                        colors: ["G"],
                                    },
                                    controller: "controller",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
];

describe("subtype-narrowed trigger heads — goldens (CR 603.2, CR 205.3)", () => {
    for (const [label, card, expected] of GOLDENS)
        it(label, () => {
            const outcome = compileCard(oracleCard(card));
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
        });
});

describe("subtype-narrowed trigger heads — the head alone (CR 603.2, CR 603.6c)", () => {
    it("you cast a noncreature or <creature type> spell is a union of two filter dimensions (CR 205.2a, CR 205.3m)", () => {
        const result = triggerHeadRule.run(
            "Whenever you cast a noncreature or Otter spell",
            parseContext()
        );
        expect(result.ok && result.value).toEqual({
            kind: "spell-cast",
            scope: "you",
            filter: {
                any: [{ excludeTypes: ["Creature"] }, { subtypes: ["Otter"] }],
            },
        });
    });
    it("a <subtype> is put into a graveyard from the battlefield is any player's permanent (CR 109.2)", () => {
        const result = triggerHeadRule.run(
            "Whenever a Food is put into a graveyard from the battlefield",
            parseContext()
        );
        expect(result.ok && result.value).toEqual({
            kind: "left-to-graveyard",
            scope: "any",
            subtypes: ["Food"],
        });
    });
});

/** A body every accepted head compiles, so a refusal is the head's own. */
const BODY = ", put a +1/+1 counter on this creature.";

const REFUSED: readonly (readonly [string, string])[] = [
    // CR 603.2c — "one or more … enter" is one trigger per event, which the
    // compiled entered head does not count; "Mice" is no regular plural.
    [
        "a batched enters over a plural list (Valley Questcaller)",
        "Whenever one or more other Rabbits, Bats, Birds, and/or Mice you control enter",
    ],
    // CR 508.3a — the compiled attacks head carries no attacker filter.
    [
        "a subtype-narrowed attacker (Zoraline, Cosmos Caller)",
        "Whenever a Bat you control attacks",
    ],
    [
        "a batched attack declaration narrowed by subtype (Hired Claw)",
        "Whenever you attack with one or more Lizards",
    ],
    // CR 603.2c — no batched combat-damage head exists.
    [
        "a batched combat-damage head (Kastral, the Windcrested)",
        "Whenever one or more Birds you control deal combat damage to a player",
    ],
    // CR 603.2c — the sacrifice head fires per permanent sacrificed.
    [
        "a batched sacrifice (Camellia, the Seedmiser)",
        "Whenever you sacrifice one or more Foods",
    ],
    // CR 205.3k — Arcane is a spell type, not a creature type.
    [
        "a spell type in a cast head",
        "Whenever you cast a Spirit or Arcane spell",
    ],
    // CR 205.3h — Shrine is an enchantment type, outside the permanent nouns.
    [
        "an enchantment type entering",
        "Whenever another Shrine you control enters",
    ],
    // No "another": the source itself qualifies, a scope with no fixture here.
    [
        'a subtype entering without "another"',
        "Whenever a Dragon you control enters",
    ],
];

describe("subtype-narrowed trigger heads — refused neighbours (ADR 0105 § 2)", () => {
    for (const [label, head] of REFUSED)
        it(label, () => {
            const outcome = compileCard(
                oracleCard({
                    name: "Refusal Probe",
                    manaCost: "{G}",
                    typeLine: "Creature — Squirrel",
                    oracleText: head + BODY,
                    power: "1",
                    toughness: "1",
                })
            );
            expect(outcome.state).toBe("unparsed");
        });
});
