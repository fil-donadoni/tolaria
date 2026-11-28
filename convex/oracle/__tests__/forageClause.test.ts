// Forage (CR 701.61a) — the "you may forage" sentence and the "Whenever you
// forage" trigger head.
//
//  1. GOLDEN fixtures — real corpus cards compiled whole, one per accepted
//     form: "you may forage. If you do, <effect>" (Treetop Sentries), "you
//     may forage. When you do, <effect>" (Curious Forager, a reflexive
//     targeted body), and the bare "you may forage." beside the "Whenever you
//     forage" head (Corpseberry Cultivator).
//  2. REFUSALS — the neighbours no fixture reads: a bare mandatory "Forage.",
//     forage as an activation cost, as a spell's additional cost, as a kicker
//     cost, and an opponent foraging.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function unparsedLines(card: ReturnType<typeof oracleCard>): string[] {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed") return [];
    return outcome.gaps.map((gap) => gap.line);
}

const SENTRIES_TEXT =
    "Reach\nWhen this creature enters, you may forage. If you do, draw a card. (To forage, exile three cards from your graveyard or sacrifice a Food.)";

const FORAGER_TEXT =
    "When this creature enters, you may forage. When you do, return target permanent card from your graveyard to your hand. (To forage, exile three cards from your graveyard or sacrifice a Food.)";

const CULTIVATOR_TEXT =
    "At the beginning of combat on your turn, you may forage. (Exile three cards from your graveyard or sacrifice a Food.)\nWhenever you forage, put a +1/+1 counter on this creature.";

const FORAGE = {
    op: "forage",
    player: "controller",
    optional: true,
    bind: "$foraged1",
} as const;

describe("Forage — golden fixtures (CR 701.61a)", () => {
    it("Treetop Sentries: 'you may forage. If you do, draw a card' gates the draw on the forage", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Treetop Sentries",
                manaCost: "{3}{G}",
                typeLine: "Creature — Squirrel Archer",
                oracleText: SENTRIES_TEXT,
                power: "2",
                toughness: "4",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Treetop Sentries",
                types: ["Creature"],
                subtypes: ["Squirrel", "Archer"],
                manaCost: { X: 3, G: 1 },
                power: 2,
                toughness: 4,
                oracleText: SENTRIES_TEXT,
                staticAbilities: ["reach"],
                compiledTriggeredAbilities: [
                    {
                        id: "treetop-sentries-trigger",
                        oracleText:
                            "When this creature enters, you may forage. If you do, draw a card.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            FORAGE,
                            {
                                op: "if",
                                predicate: { binding: "$foraged1" },
                                then: [
                                    {
                                        op: "draw",
                                        player: "controller",
                                        count: 1,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Curious Forager: 'When you do' is a reflexive ability behind the forage", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Curious Forager",
                manaCost: "{2}{G}",
                typeLine: "Creature — Squirrel Druid",
                oracleText: FORAGER_TEXT,
                power: "3",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Curious Forager",
                types: ["Creature"],
                subtypes: ["Squirrel", "Druid"],
                manaCost: { X: 2, G: 1 },
                power: 3,
                toughness: 2,
                oracleText: FORAGER_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "curious-forager-trigger",
                        oracleText:
                            "When this creature enters, you may forage. When you do, return target permanent card from your graveyard to your hand.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            FORAGE,
                            {
                                op: "if",
                                predicate: { binding: "$foraged1" },
                                then: [
                                    {
                                        op: "reflexiveTrigger",
                                        oracleText:
                                            "When you do, return target permanent card from your graveyard to your hand.",
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
                                            zone: "graveyard",
                                            controller: "you",
                                        },
                                        effects: [
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
                    },
                ],
            })
        );
    });

    it("Corpseberry Cultivator: a bare 'you may forage.' and the 'Whenever you forage' head", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Corpseberry Cultivator",
                manaCost: "{1}{B/G}{B/G}",
                typeLine: "Creature — Squirrel Warlock",
                oracleText: CULTIVATOR_TEXT,
                power: "2",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Corpseberry Cultivator",
                types: ["Creature"],
                subtypes: ["Squirrel", "Warlock"],
                manaCost: {
                    X: 1,
                    hybrid: [
                        ["B", "G"],
                        ["B", "G"],
                    ],
                },
                power: 2,
                toughness: 3,
                oracleText: CULTIVATOR_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "corpseberry-cultivator-trigger",
                        oracleText:
                            "At the beginning of combat on your turn, you may forage.",
                        head: {
                            kind: "phase",
                            phase: "BEGINNING_OF_COMBAT",
                            scope: "your",
                        },
                        effects: [FORAGE],
                    },
                    {
                        id: "corpseberry-cultivator-trigger-2",
                        oracleText:
                            "Whenever you forage, put a +1/+1 counter on this creature.",
                        head: { kind: "foraged", scope: "you" },
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
            })
        );
    });
});

describe("Forage — refused neighbours (fail-closed)", () => {
    const creature = (oracleText: string) =>
        oracleCard({
            name: "Forage Probe",
            manaCost: "{1}{G}",
            typeLine: "Creature — Squirrel",
            oracleText,
            power: "2",
            toughness: "2",
        });

    it("a bare mandatory 'Forage.' is no printed form", () => {
        const line = "When this creature enters, forage.";
        expect(unparsedLines(creature(line))).toEqual([line]);
    });

    it("'you may forage twice' is not the bare action", () => {
        const line =
            "When this creature enters, you may forage twice. If you do, draw a card.";
        expect(unparsedLines(creature(line))).toEqual([line]);
    });

    it("forage as an activation cost stays refused (Thornvault Forager)", () => {
        const line = "{T}, Forage: Add two mana in any combination of colors.";
        expect(unparsedLines(creature(line))).toEqual([line]);
    });

    it("forage as an activated ability's cost stays refused (Camellia, the Seedmiser)", () => {
        const line =
            "{2}, Forage: Put a +1/+1 counter on each other Squirrel you control.";
        expect(unparsedLines(creature(line))).toEqual([line]);
    });

    it("forage as a spell's additional cost stays refused (Feed the Cycle)", () => {
        const line =
            "As an additional cost to cast this spell, forage or pay {B}.";
        const spell = oracleCard({
            name: "Forage Probe Spell",
            manaCost: "{1}{B}",
            typeLine: "Instant",
            oracleText: `${line}\nDestroy target creature or planeswalker.`,
        });
        expect(unparsedLines(spell)).toEqual([line]);
    });

    it("'Whenever an opponent forages' is not the 'you' head", () => {
        const line = "Whenever an opponent forages, draw a card.";
        expect(unparsedLines(creature(line))).toEqual([line]);
    });
});
