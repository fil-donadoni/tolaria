// Tribal conditions and lord statics (issue #10346): the resolution-time
// gates "If you control a <subtype>, <effect>" and "If that creature is a
// <subtype list>, <effect>" (CR 608.2c), the one-clause "If you control a
// Bird, … instead" counter-tax upgrade (CR 118.12a), and the lord P/T
// subjects "Other Mice" and "Other Rabbits, Bats, Birds, and Mice"
// (CR 613.4c, CR 205.3).
//
// Two layers:
//
//  1. GOLDEN — a real corpus card (or, for a lord, its real lord line beside
//     the card's own name, cost and type line) compiled whole must produce
//     exactly this Compiled Definition. The four spells are the
//     `GOLDEN_FIXTURES` rows that clear their smoke-scenario skips.
//  2. REFUSALS — the neighbour forms the rules must not read (fail-closed,
//     ADR 0105 § 2): a gate body no sentence reads, "that creature" with no
//     creature put onto the battlefield, an "and" list of subtypes, a subtype
//     list outside the lord frame, an irregular plural no fixture lists, and
//     the member gaps out of reach (a granted ward, a count over the
//     battlefield in a static buff).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

function fixture(name: string) {
    const row = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (row === undefined) throw new Error(`no golden fixture for ${name}`);
    return row;
}

function spell(oracleText: string, typeLine = "Instant") {
    return oracleCard({
        oracleText,
        typeLine,
        manaCost: "{1}{U}",
        power: undefined,
        toughness: undefined,
    });
}

function creature(oracleText: string, typeLine = "Creature — Rabbit Warrior") {
    return oracleCard({ oracleText, typeLine, manaCost: "{1}{W}" });
}

describe("golden — leading gate (CR 608.2c)", () => {
    for (const name of [
        "Rabbit Response",
        "Take Out the Trash",
        "Splash Portal",
    ]) {
        it(`${name} compiles to its fixture`, () => {
            const row = fixture(name);
            expect(row.rule).toBe("leading gate");
            const outcome = compileCard(row.card);
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(row.expected)
            );
        });
    }

    it("Rabbit Response gates the scry on a count of the controller's Rabbits (CR 109.5)", () => {
        const effects = fixture("Rabbit Response").expected.effects!;
        expect(effects[1]).toEqual({
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { subtype: "Rabbit" },
                    },
                },
                op: "ge",
                right: 1,
            },
            then: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "library-bottom",
                },
            ],
        });
    });

    it('Take Out the Trash puts the "If you do" fold behind the gate (CR 118.12)', () => {
        const gate = fixture("Take Out the Trash").expected.effects![1]!;
        expect(gate.op).toBe("if");
        if (gate.op !== "if") return;
        expect(gate.then.map((op) => op.op)).toEqual(["mayPay", "if"]);
    });

    it("Splash Portal reads the returned creature through the return's own bind (CR 400.7)", () => {
        const effects = fixture("Splash Portal").expected.effects!;
        const returned = effects[1]!;
        expect(returned.op).toBe("moveZone");
        if (returned.op !== "moveZone" || !("bind" in returned)) return;
        expect(effects[2]).toMatchObject({
            op: "if",
            predicate: {
                objectMatchesFilter: { ref: returned.bind },
                filter: { subtype: ["Bird", "Frog", "Otter", "Rat"] },
            },
        });
    });
});

describe("golden — one-clause counter-tax upgrade (CR 608.2c + CR 118.12a)", () => {
    it("Dazzling Denial compiles to its fixture", () => {
        const row = fixture("Dazzling Denial");
        expect(row.rule).toBe("instead if you control");
        const outcome = compileCard(row.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(sortKeys(row.expected));
    });

    it("the Bird branch taxes {4}, the base branch {2}", () => {
        const gate = fixture("Dazzling Denial").expected.effects![0]!;
        expect(gate).toMatchObject({
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { subtype: "Bird" },
                    },
                },
                op: "ge",
                right: 1,
            },
            then: [{ op: "mayPay", cost: { X: 4 } }, { op: "if" }],
            else: [{ op: "mayPay", cost: { X: 2 } }, { op: "if" }],
        });
    });
});

describe("golden — lord subjects (CR 613.4c + CR 205.3)", () => {
    it('Mabel, Heir to Cragflame: "Other Mice you control get +1/+1"', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Mabel, Heir to Cragflame",
                manaCost: "{1}{R}{W}",
                typeLine: "Legendary Creature — Mouse Soldier",
                power: "3",
                toughness: "3",
                oracleText: "Other Mice you control get +1/+1.",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Mabel, Heir to Cragflame",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Mouse", "Soldier"],
                manaCost: { X: 1, W: 1, R: 1 },
                power: 3,
                toughness: 3,
                oracleText: "Other Mice you control get +1/+1.",
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        filter: {
                            types: ["Creature"],
                            subtypes: ["Mouse"],
                            controllerRelation: "you",
                            excludeSource: true,
                        },
                        power: 1,
                        toughness: 1,
                    },
                ],
            })
        );
    });

    it('Valley Questcaller: "Other Rabbits, Bats, Birds, and Mice you control get +1/+1"', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Valley Questcaller",
                manaCost: "{1}{W}",
                typeLine: "Creature — Rabbit Warrior",
                power: "2",
                toughness: "3",
                oracleText:
                    "Other Rabbits, Bats, Birds, and Mice you control get +1/+1.",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Valley Questcaller",
                types: ["Creature"],
                subtypes: ["Rabbit", "Warrior"],
                manaCost: { X: 1, W: 1 },
                power: 2,
                toughness: 3,
                oracleText:
                    "Other Rabbits, Bats, Birds, and Mice you control get +1/+1.",
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        filter: {
                            types: ["Creature"],
                            subtypes: ["Rabbit", "Bat", "Bird", "Mouse"],
                            controllerRelation: "you",
                            excludeSource: true,
                        },
                        power: 1,
                        toughness: 1,
                    },
                ],
            })
        );
    });

    it('Ultron, Machine Overlord: the pair "Other Robots and Constructs you control get +2/+2"', () => {
        const oracleText =
            "Flying\nOther Robots and Constructs you control get +2/+2.";
        const outcome = compileCard(
            oracleCard({
                name: "Ultron, Machine Overlord",
                manaCost: "{5}",
                typeLine: "Legendary Artifact Creature — Robot Villain",
                power: "4",
                toughness: "4",
                oracleText,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Ultron, Machine Overlord",
                types: ["Artifact", "Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Robot", "Villain"],
                manaCost: { X: 5 },
                power: 4,
                toughness: 4,
                oracleText,
                staticAbilities: ["flying"],
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        filter: {
                            types: ["Creature"],
                            subtypes: ["Robot", "Construct"],
                            controllerRelation: "you",
                            excludeSource: true,
                        },
                        power: 2,
                        toughness: 2,
                    },
                ],
            })
        );
    });
});

describe("refusals — neighbours the rules do not read (ADR 0105 § 2)", () => {
    const refused: readonly (readonly [
        string,
        ReturnType<typeof oracleCard>,
    ])[] = [
        // Psychic Whorl: the gate reads, its body "surveil 2" does not
        // (the `Surveil N` gap, claimed by issue #8502).
        [
            "a gate over a body no sentence reads",
            spell(
                "Target opponent discards two cards. Then if you control a Rat, surveil 2.",
                "Sorcery"
            ),
        ],
        [
            '"that creature" with no creature put onto the battlefield',
            spell(
                "Draw a card. If that creature is a Bird, Frog, Otter, or Rat, draw a card."
            ),
        ],
        [
            'an "and" list of subtypes behind "that creature is"',
            spell(
                "Exile target creature you control, then return it to the battlefield under its owner's control. If that creature is a Bird, Frog, Otter, and Rat, draw a card.",
                "Sorcery"
            ),
        ],
        [
            "an article that does not agree with the list",
            spell(
                "Exile target creature you control, then return it to the battlefield under its owner's control. If that creature is an Bird, Frog, Otter, or Rat, draw a card.",
                "Sorcery"
            ),
        ],
        [
            'three controls clauses before "instead"',
            spell(
                "Counter target spell unless its controller pays {2}. If you control a Bird and a Rabbit and a Rat, counter that spell unless its controller pays {4} instead."
            ),
        ],
        [
            "a counter-tax upgrade naming another spell",
            spell(
                "Counter target spell unless its controller pays {2}. If you control a Bird, counter target spell unless its controller pays {4} instead."
            ),
        ],
        [
            "a subtype list on a lord that is not Other",
            creature("Rabbits, Bats, Birds, and Mice you control get +1/+1."),
        ],
        [
            "a subtype list behind a keyword grant",
            creature(
                "Other Rabbits, Bats, Birds, and Mice you control have flying."
            ),
        ],
        [
            "an irregular plural no fixture lists",
            creature("Other Elves you control get +1/+1.", "Creature — Elf"),
        ],
        // Long River Lurker: a granted ward has no JSON shape (its
        // trigger's `matches` is a closure, `cards/abilities/ward.ts`).
        [
            "a granted ward",
            creature(
                "Other Frogs you control have ward {1}.",
                "Creature — Frog Scout"
            ),
        ],
        // Persistent Marshstalker: a compiled `pt-buff` counts only the
        // controller's graveyard (`CompiledPtBuffCount`).
        [
            "a static buff counted over the battlefield",
            creature(
                "This creature gets +1/+0 for each other Rat you control.",
                "Creature — Rat Berserker"
            ),
        ],
    ];
    for (const [form, card] of refused)
        it(`refuses ${form}`, () => {
            expect(compileCard(card).state).toBe("unparsed");
        });
});
