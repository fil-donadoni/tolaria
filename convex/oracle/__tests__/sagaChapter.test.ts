// Saga chapter lines (CR 714.2, issue #8056): a chapter is a line of a Saga, on
// the `saga` layout and on a Saga face of a `transform` card.
//
//  1. GOLDENS — real Oracle rows, the whole definition, `chapters` asserted.
//  2. ROUND TRIP — the hand-written History of Benalia (verdict `equal`).
//  3. REFUSALS — a card is refused whole, never truncated.
//  4. THE GATES — a chapter's script is judged like any ability's.
//  5. THE SEAM — a compiled Saga is what `expandChapterAbilities` expects.

import { describe, expect, it } from "vitest";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { finalChapter } from "../../gre/sagas";
import { compileCard } from "../compile";
import { runGates, sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompileOutcome, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const REMINDER =
    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";

function saga(name: string, lines: readonly string[]): OracleCard {
    return oracleCard({
        name,
        manaCost: "{2}{W}",
        typeLine: "Enchantment — Saga",
        oracleText: [REMINDER, ...lines].join("\n"),
        power: undefined,
        toughness: undefined,
        layout: "saga",
    });
}

function definitionOf(outcome: CompileOutcome) {
    if (outcome.state === "unparsed")
        throw new Error(`refused: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

function refusals(outcome: CompileOutcome): readonly string[] {
    if (outcome.state !== "unparsed")
        throw new Error(`compiled to ${outcome.state}`);
    return outcome.gaps.map((g) => g.reason);
}

function refusedLines(outcome: CompileOutcome): readonly string[] {
    if (outcome.state !== "unparsed")
        throw new Error(`compiled to ${outcome.state}`);
    return outcome.gaps.map((g) => g.line);
}

const HISTORY_OF_BENALIA: OracleCard = {
    name: "History of Benalia",
    manaCost: "{1}{W}{W}",
    typeLine: "Enchantment — Saga",
    oracleText:
        "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.",
    oracleId: "c15bb7eb-aaaa-4468-9641-8f706d6137e8",
    layout: "saga",
};

describe("chapter goldens (CR 714.2b, CR 714.2c)", () => {
    it("reads `I —` and the multi-numeral `I, II —` (History of Benalia)", () => {
        const outcome = compileCard(HISTORY_OF_BENALIA);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(definitionOf(outcome))).toEqual(
            sortKeys({
                name: "History of Benalia",
                types: ["Enchantment"],
                subtypes: ["Saga"],
                manaCost: {
                    X: 1,
                    W: 2,
                },
                oracleText:
                    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.",
                chapterAbilities: [
                    {
                        chapters: [1, 2],
                        oracleText:
                            "I, II — Create a 2/2 white Knight creature token with vigilance.",
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Knight",
                                    types: ["Creature"],
                                    subtypes: ["Knight"],
                                    power: 2,
                                    toughness: 2,
                                    colors: ["W"],
                                    staticAbilities: ["vigilance"],
                                },
                                controller: "controller",
                            },
                        ],
                    },
                    {
                        chapters: [3],
                        oracleText:
                            "III — Knights you control get +2/+1 until end of turn.",
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        subtype: "Knight",
                                    },
                                },
                                effects: [
                                    {
                                        op: "pump",
                                        target: {
                                            ref: "$each",
                                        },
                                        power: 2,
                                        toughness: 1,
                                        duration: {
                                            phase: "end-of-turn",
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reads one line per chapter, the slot named on the outcome (Founding of Omashu)", () => {
        const outcome = compileCard({
            name: "Founding of Omashu",
            manaCost: "{2}{R}",
            typeLine: "Enchantment — Saga",
            oracleText:
                "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Create two 1/1 white Ally creature tokens.\nII — You may discard a card. If you do, draw a card.\nIII — Creatures you control get +1/+0 until end of turn.",
            oracleId: "ea58fb10-3d70-4c25-b317-615dfb20a48d",
            layout: "saga",
        });
        expect(outcome.state).toBe("ready");
        expect(outcome.state !== "unparsed" && outcome.slots).toEqual([
            "chapter",
        ]);
        expect(sortKeys(definitionOf(outcome))).toEqual(
            sortKeys({
                name: "Founding of Omashu",
                types: ["Enchantment"],
                subtypes: ["Saga"],
                manaCost: {
                    X: 2,
                    R: 1,
                },
                oracleText:
                    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Create two 1/1 white Ally creature tokens.\nII — You may discard a card. If you do, draw a card.\nIII — Creatures you control get +1/+0 until end of turn.",
                chapterAbilities: [
                    {
                        chapters: [1],
                        oracleText:
                            "I — Create two 1/1 white Ally creature tokens.",
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Ally",
                                    types: ["Creature"],
                                    subtypes: ["Ally"],
                                    power: 1,
                                    toughness: 1,
                                    colors: ["W"],
                                },
                                controller: "controller",
                                count: 2,
                            },
                        ],
                    },
                    {
                        chapters: [2],
                        oracleText:
                            "II — You may discard a card. If you do, draw a card.",
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: {
                                    hand: {
                                        action: "discard",
                                        requirements: [
                                            {
                                                filter: {},
                                                count: 1,
                                            },
                                        ],
                                    },
                                },
                                prompt: "Discard a card?",
                                bind: "$paid1",
                            },
                            {
                                op: "if",
                                predicate: {
                                    binding: "$paid1",
                                },
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
                    {
                        chapters: [3],
                        oracleText:
                            "III — Creatures you control get +1/+0 until end of turn.",
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        type: "Creature",
                                    },
                                },
                                effects: [
                                    {
                                        op: "pump",
                                        target: {
                                            ref: "$each",
                                        },
                                        power: 1,
                                        toughness: 0,
                                        duration: {
                                            phase: "end-of-turn",
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("drops a flavor word heading the effect, keeps it in the text, and reads a creature Saga (CR 207.2d, CR 714.1a; Summon: Choco/Mog)", () => {
        const outcome = compileCard({
            name: "Summon: Choco/Mog",
            manaCost: "{2}{W}",
            typeLine: "Enchantment Creature — Saga Bird Moogle",
            oracleText:
                "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III, IV — Stampede! — Other creatures you control get +1/+0 until end of turn.",
            power: "3",
            toughness: "3",
            oracleId: "8b4bfdc5-8c0a-40c3-abbf-ada4a536dc34",
            layout: "saga",
        });
        expect(outcome.state).toBe("ready");
        expect(sortKeys(definitionOf(outcome))).toEqual(
            sortKeys({
                name: "Summon: Choco/Mog",
                types: ["Enchantment", "Creature"],
                subtypes: ["Saga", "Bird", "Moogle"],
                manaCost: {
                    X: 2,
                    W: 1,
                },
                power: 3,
                toughness: 3,
                oracleText:
                    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III, IV — Stampede! — Other creatures you control get +1/+0 until end of turn.",
                chapterAbilities: [
                    {
                        chapters: [1, 2, 3, 4],
                        oracleText:
                            "I, II, III, IV — Stampede! — Other creatures you control get +1/+0 until end of turn.",
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        type: "Creature",
                                    },
                                    excludeSource: true,
                                },
                                effects: [
                                    {
                                        op: "pump",
                                        target: {
                                            ref: "$each",
                                        },
                                        power: 1,
                                        toughness: 0,
                                        duration: {
                                            phase: "end-of-turn",
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reads `this Saga` as the source on a Saga face of a transform card (CR 712.14a)", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) =>
                f.card.name === "Era of Enlightenment // Hand of Enlightenment"
        )!;
        const outcome = compileCard(fixture.card);
        expect(outcome.state).toBe("ready");
        const chapters = definitionOf(outcome).chapterAbilities!;
        expect(chapters.map((c) => c.chapters)).toEqual([[1], [2], [3]]);
        expect(chapters[2]!.effects).toEqual([
            {
                op: "exileAndReturnTransformed",
                target: { ref: "$source" },
                controller: "controller",
            },
        ]);
    });
});

describe("Guard C (CR 714.2)", () => {
    it("History of Benalia round-trips to `equal`", () => {
        const { verdict } = roundTripCard(
            getDefinition(getCardByName("History of Benalia").id)
        );
        expect(verdict).toEqual({ ok: true, kind: "equal" });
    });
});

describe("refusals: a Saga is refused whole (ADR 0105 § 2)", () => {
    it("an unparsed chapter body refuses the card (Phyrexian Scriptures)", () => {
        const line = "III — Exile all opponents' graveyards.";
        const outcome = compileCard(
            saga("Phyrexian Scriptures", [
                "II — Destroy all nonartifact creatures.",
                line,
            ])
        );
        expect(refusedLines(outcome)).toEqual([line]);
    });

    it("Read Ahead refuses, whatever its chapters print (CR 702.155; Founding the Third Path)", () => {
        const outcome = compileCard(
            saga("Founding the Third Path", ["Read ahead", "I — Draw a card."])
        );
        expect(refusedLines(outcome)).toEqual(["Read ahead"]);
    });

    it("a chapter with a target declares it on the chapter (CR 603.3d; Balance of Terror, Binding the Old Gods)", () => {
        const balance = definitionOf(
            compileCard(
                saga("Balance of Terror", [
                    "I — Destroy up to one other target artifact or enchantment.",
                ])
            )
        );
        expect(balance.chapterAbilities).toEqual([
            {
                chapters: [1],
                oracleText:
                    "I — Destroy up to one other target artifact or enchantment.",
                effects: [{ op: "destroy", target: { target: 0 } }],
                targetRequirement: {
                    type: ["Artifact", "Enchantment"],
                    count: { min: 0, max: 1 },
                    excludeSource: true,
                },
            },
        ]);
        const binding = definitionOf(
            compileCard(
                saga("Binding the Old Gods", [
                    "I — Destroy target nonland permanent an opponent controls.",
                ])
            )
        );
        expect(binding.chapterAbilities?.[0]?.targetRequirement).toEqual({
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
            controller: "opponent",
        });
    });

    it("a numeral with no separating dash is no chapter (`I Denial —`)", () => {
        const line = "I Denial — Draw a card.";
        expect(refusedLines(compileCard(saga("Neighbour", [line])))).toEqual([
            line,
        ]);
    });

    it.each([
        ["descending", "II, I — Draw a card."],
        ["not a numeral", "VII — Draw a card."],
        ["no space around the dash", "I—Draw a card."],
        ["a second flavor head", "I — One — Two — Draw a card."],
        [
            "a head with rules meaning",
            "I — Target opponent faces a villainous choice — Draw a card.",
        ],
    ])("%s refuses", (_label, line) => {
        expect(refusedLines(compileCard(saga("Neighbour", [line])))).toEqual([
            line,
        ]);
    });

    it("a chapter number printed on two lines refuses", () => {
        const outcome = compileCard(
            saga("Neighbour", ["I, II — Draw a card.", "II — You gain 2 life."])
        );
        expect(refusals(outcome)).toEqual([
            "a chapter number printed on two lines",
        ]);
    });

    it("a chapter line on a card that is not a Saga refuses (CR 205.3h)", () => {
        const line = "I — Draw a card.";
        const outcome = compileCard(
            oracleCard({
                name: "Neighbour",
                manaCost: "{1}",
                typeLine: "Enchantment",
                oracleText: line,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(refusedLines(outcome)).toEqual([line]);
    });

    it("a Saga BACK face refuses: `CardBackFace` has no chapter abilities", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Front // Back",
                manaCost: "{1}",
                typeLine: "Creature — Human // Enchantment — Saga",
                oracleText: "",
                layout: "transform",
                power: undefined,
                toughness: undefined,
                faces: [
                    {
                        name: "Front",
                        manaCost: "{1}",
                        typeLine: "Creature — Human",
                        oracleText: "",
                        power: "1",
                        toughness: "1",
                    },
                    {
                        name: "Back",
                        manaCost: "",
                        typeLine: "Enchantment — Saga",
                        oracleText: "I — Draw a card.",
                        colors: ["W"],
                    },
                ],
            })
        );
        expect(refusals(outcome)).toEqual([
            "transform back face carries chapterAbilities, which a CardBackFace cannot hold",
        ]);
    });
});

describe("gates: a chapter's script is judged like any ability's", () => {
    it("an invalid chapter script quarantines (CR 714.2b)", () => {
        const { reasons } = runGates({
            oracleId: "chapter-gate",
            definition: {
                name: "Gate",
                types: ["Enchantment"],
                subtypes: ["Saga"],
                chapterAbilities: [
                    {
                        chapters: [1],
                        oracleText: "I — Nothing.",
                        effects: [
                            {
                                op: "draw",
                                player: { ref: "$nowhere" },
                                count: 1,
                            },
                        ],
                    },
                ],
            },
            plannedMechanics: [],
            ungrantableKeywords: [],
        });
        expect(reasons.map((r) => r.kind)).toContain("validate-effect-script");
    });

    it("a chapter's card-dependent smoke skip quarantines without its fixture (CR 714.2b)", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "The Birth of Meletis"
        )!;
        const { reasons } = runGates({
            oracleId: fixture.card.oracleId,
            definition: fixture.expected,
            plannedMechanics: [],
            ungrantableKeywords: [],
            fixtures: [],
        });
        expect(new Set(reasons.map((r) => r.kind))).toEqual(
            new Set(["smoke-scenario"])
        );
    });
});

describe("the seam: what `expandChapterAbilities` makes of a compiled Saga", () => {
    it("triggers per line, the entry lore counter and the final chapter (CR 714.2b, CR 714.2d, CR 714.3a)", () => {
        const compiled = definitionOf(compileCard(HISTORY_OF_BENALIA));
        const declared: CardDefinition = {
            ...compiled,
            id: "compiled-history-of-benalia",
            rarity: "mythic",
        };
        withTemporaryDefinition(declared, () => {
            const definition = getDefinition(declared.id);
            expect(
                definition.triggeredAbilities?.map((t) => t.chapterNumbers)
            ).toEqual([[1, 2], [3]]);
            expect(definition.entersWith?.counters).toEqual([
                { type: "lore", count: 1 },
            ]);
            const saga = makeInstance(declared.id);
            expect(finalChapter(saga)).toBe(3);
        });
    });
});
