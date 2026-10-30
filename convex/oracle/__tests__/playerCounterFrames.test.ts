// Player-counter and monarch Verb Frames (CR 122.1, CR 107.14, CR 725.1,
// issue #4536).
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce
//     exactly this Compiled Definition (`sortKeys` equality). Smoke-scenario
//     generation covers these Ops, so no `GOLDEN_FIXTURES` row is owed.
//  2. REFUSALS — the neighbours the frames do not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const GOLDENS = [
    {
        form: 'monarch \u2014 triggered, "you become the monarch" (CR 725.1)',
        card: {
            name: "Thorn of the Black Rose",
            manaCost: "{3}{B}",
            typeLine: "Creature \u2014 Human Assassin",
            oracleText:
                "Deathtouch\nWhen this creature enters, you become the monarch.",
            power: "1",
            toughness: "3",
        },
        definition: {
            name: "Thorn of the Black Rose",
            types: ["Creature"],
            subtypes: ["Human", "Assassin"],
            manaCost: { X: 3, B: 1 },
            power: 1,
            toughness: 3,
            oracleText:
                "Deathtouch\nWhen this creature enters, you become the monarch.",
            staticAbilities: ["deathtouch"],
            compiledTriggeredAbilities: [
                {
                    id: "thorn-of-the-black-rose-trigger",
                    oracleText:
                        "When this creature enters, you become the monarch.",
                    head: { kind: "entered", scope: "self" },
                    effects: [{ op: "becomeMonarch" }],
                },
            ],
        },
    },
    {
        form: "monarch \u2014 activated ability",
        card: {
            name: "Throne of the High City",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "{T}: Add {C}.\n{4}, {T}, Sacrifice this land: You become the monarch.",
        },
        definition: {
            name: "Throne of the High City",
            types: ["Land"],
            oracleText:
                "{T}: Add {C}.\n{4}, {T}, Sacrifice this land: You become the monarch.",
            activatedAbilities: [
                {
                    id: "throne-of-the-high-city-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "throne-of-the-high-city-ability-2",
                    oracleText:
                        "{4}, {T}, Sacrifice this land: You become the monarch.",
                    cost: { mana: { X: 4 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [{ op: "becomeMonarch" }],
                },
            ],
        },
    },
    {
        form: "monarch \u2014 spell sentence after another effect",
        card: {
            name: "Feast of Succession",
            manaCost: "{4}{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "All creatures get -4/-4 until end of turn. You become the monarch.",
        },
        definition: {
            name: "Feast of Succession",
            types: ["Sorcery"],
            manaCost: { X: 4, B: 2 },
            oracleText:
                "All creatures get -4/-4 until end of turn. You become the monarch.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: -4,
                            toughness: -4,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
                { op: "becomeMonarch" },
            ],
        },
    },
    {
        form: 'poison \u2014 "defending player gets a poison counter" (CR 122.1)',
        card: {
            name: "Swamp Mosquito",
            manaCost: "{1}{B}",
            typeLine: "Creature \u2014 Insect",
            oracleText:
                "Flying\nWhenever this creature attacks and isn't blocked, defending player gets a poison counter. (A player with ten or more poison counters loses the game.)",
            power: "0",
            toughness: "1",
        },
        definition: {
            name: "Swamp Mosquito",
            types: ["Creature"],
            subtypes: ["Insect"],
            manaCost: { X: 1, B: 1 },
            power: 0,
            toughness: 1,
            oracleText:
                "Flying\nWhenever this creature attacks and isn't blocked, defending player gets a poison counter. (A player with ten or more poison counters loses the game.)",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "swamp-mosquito-trigger",
                    oracleText:
                        "Whenever this creature attacks and isn't blocked, defending player gets a poison counter.",
                    head: { kind: "attacks-unblocked" },
                    effects: [
                        {
                            op: "addPlayerCounter",
                            player: "opponent",
                            counter: "poison",
                            amount: 1,
                        },
                    ],
                },
            ],
        },
    },
    {
        form: 'poison \u2014 "you get a poison counter"',
        card: {
            name: "Phyrexian Vatmother",
            manaCost: "{2}{B}{B}",
            typeLine: "Creature \u2014 Phyrexian Horror",
            oracleText:
                "Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nAt the beginning of your upkeep, you get a poison counter.",
            power: "4",
            toughness: "5",
        },
        definition: {
            name: "Phyrexian Vatmother",
            types: ["Creature"],
            subtypes: ["Phyrexian", "Horror"],
            manaCost: { X: 2, B: 2 },
            power: 4,
            toughness: 5,
            oracleText:
                "Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nAt the beginning of your upkeep, you get a poison counter.",
            staticAbilities: ["infect"],
            compiledTriggeredAbilities: [
                {
                    id: "phyrexian-vatmother-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you get a poison counter.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "addPlayerCounter",
                            player: "controller",
                            counter: "poison",
                            amount: 1,
                        },
                    ],
                },
            ],
        },
    },
    {
        form: 'energy \u2014 "you get {E}{E}{E}" (CR 107.14)',
        card: {
            name: "Sage of Shaila's Claim",
            manaCost: "{1}{G}",
            typeLine: "Creature \u2014 Elf Druid",
            oracleText:
                "When this creature enters, you get {E}{E}{E} (three energy counters).",
            power: "2",
            toughness: "1",
        },
        definition: {
            name: "Sage of Shaila's Claim",
            types: ["Creature"],
            subtypes: ["Elf", "Druid"],
            manaCost: { X: 1, G: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "When this creature enters, you get {E}{E}{E} (three energy counters).",
            compiledTriggeredAbilities: [
                {
                    id: "sage-of-shaila-s-claim-trigger",
                    oracleText:
                        "When this creature enters, you get {E}{E}{E} .",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "addPlayerCounter",
                            player: "controller",
                            counter: "energy",
                            amount: 3,
                        },
                    ],
                },
            ],
        },
    },
] as const;

describe("player-counter and monarch frames — goldens", () => {
    for (const golden of GOLDENS)
        it(`${golden.card.name}: ${golden.form}`, () => {
            const outcome = compileCard(oracleCard({ ...golden.card }));
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(golden.definition)
            );
        });
});

describe("player-counter and monarch frames — refusals", () => {
    const refused: readonly [string, string][] = [
        [
            "a counter kind with no player counter Op (rad)",
            "When this creature enters, target player gets two rad counters.",
        ],
        [
            "a player group the lowering cannot resolve (each player)",
            "When this creature enters, each player gets a poison counter.",
        ],
        [
            "the monarch handed to another player",
            "When this creature enters, target opponent becomes the monarch.",
        ],
        [
            "a monarch sentence with a trailing duration",
            "When this creature enters, you become the monarch this turn.",
        ],
    ];
    for (const [label, oracleText] of refused)
        it(`refuses ${label}`, () => {
            const outcome = compileCard(
                oracleCard({ oracleText, typeLine: "Creature — Bear" })
            );
            expect(outcome.state).toBe("unparsed");
        });
});
