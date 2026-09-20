// Player verbs with a count: "you draw N cards and you lose N life" and
// "target player discards N cards" (CR 121.1, CR 119.3, CR 701.9a, CR 608.2c,
// issue #4130).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: the draw-then-lose
//     conjunction at a self-enters head (a card, and two cards), at an upkeep
//     head, and the discard the player chooses.
//  2. REFUSALS — the neighbours the corpus prints that this rule does not
//     read: an elided second subject, a rider on the discard, an X count.
//  3. The lowering invariants: the conjunction keeps its printed ORDER, and
//     the discard is chosen by the player it names, never the controller.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Partial<CardDefinition> & Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("Player verbs — golden fixtures (CR 121.1, CR 119.3, CR 608.2c)", () => {
    it("you draw a card and you lose N life, self-enters head: Phyrexian Rager", () => {
        const text =
            "When this creature enters, you draw a card and you lose 1 life.";
        expectDefinition(
            oracleCard({
                name: "Phyrexian Rager",
                manaCost: "{2}{B}",
                typeLine: "Creature — Phyrexian Horror",
                oracleText: text,
                power: "2",
                toughness: "2",
            }),
            {
                name: "Phyrexian Rager",
                types: ["Creature"],
                subtypes: ["Phyrexian", "Horror"],
                manaCost: { X: 2, B: 1 },
                power: 2,
                toughness: 2,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "phyrexian-rager-trigger",
                        oracleText: text,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                            { op: "loseLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            }
        );
    });

    it("you draw two cards and you lose N life: Phyrexian Gargantua", () => {
        const text =
            "When this creature enters, you draw two cards and you lose 2 life.";
        expectDefinition(
            oracleCard({
                name: "Phyrexian Gargantua",
                manaCost: "{4}{B}{B}",
                typeLine: "Creature — Phyrexian Horror",
                oracleText: text,
                power: "4",
                toughness: "4",
            }),
            {
                name: "Phyrexian Gargantua",
                types: ["Creature"],
                subtypes: ["Phyrexian", "Horror"],
                manaCost: { X: 4, B: 2 },
                power: 4,
                toughness: 4,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "phyrexian-gargantua-trigger",
                        oracleText: text,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 2 },
                            { op: "loseLife", player: "controller", amount: 2 },
                        ],
                    },
                ],
            }
        );
    });

    it("the same conjunction at an upkeep head: Phyrexian Arena", () => {
        const text =
            "At the beginning of your upkeep, you draw a card and you lose 1 life.";
        expectDefinition(
            oracleCard({
                name: "Phyrexian Arena",
                manaCost: "{1}{B}{B}",
                typeLine: "Enchantment",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            }),
            {
                name: "Phyrexian Arena",
                types: ["Enchantment"],
                manaCost: { X: 1, B: 2 },
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "phyrexian-arena-trigger",
                        oracleText: text,
                        head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                            { op: "loseLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            }
        );
    });

    it("target player discards two cards, the player's choice: Mind Rot", () => {
        expectDefinition(
            sorcery("Mind Rot", "{2}{B}", "Target player discards two cards."),
            {
                name: "Mind Rot",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 1 },
                oracleText: "Target player discards two cards.",
                effects: [
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: { target: 0 },
                        zone: "hand",
                        count: 2,
                        prompt: "Discard two cards.",
                        bind: "$discard1",
                    },
                    {
                        op: "discard",
                        player: { target: 0 },
                        cards: { ref: "$discard1" },
                    },
                ],
                targetRequirement: { type: "player", count: 1 },
            }
        );
    });
});

describe("Player verbs — refusals (fail-closed neighbours)", () => {
    const refused = (card: ReturnType<typeof oracleCard>) =>
        compileCard(card).state;

    it("an elided second subject is not the explicit-you conjunction: Painful Lesson", () => {
        expect(
            refused(
                sorcery(
                    "Painful Lesson",
                    "{2}{B}",
                    "Target player draws two cards and loses 2 life."
                )
            )
        ).toBe("unparsed");
    });

    it("a discard carrying a rider is refused whole: Wrench Mind", () => {
        expect(
            refused(
                sorcery(
                    "Wrench Mind",
                    "{B}{B}",
                    "Target player discards two cards unless they discard an artifact card."
                )
            )
        ).toBe("unparsed");
    });

    it("a discard joined to a life loss is refused, not half-read: Mental Agony", () => {
        expect(
            refused(
                sorcery(
                    "Mental Agony",
                    "{3}{B}",
                    "Target player discards two cards and loses 2 life."
                )
            )
        ).toBe("unparsed");
    });

    it("a discard followed by a count of what was discarded is refused: Forget", () => {
        expect(
            refused(
                sorcery(
                    "Forget",
                    "{U}{U}",
                    "Target player discards two cards, then draws as many cards as they discarded this way."
                )
            )
        ).toBe("unparsed");
    });

    it("the conjunction pins its two verbs: a draw then a gain is not read", () => {
        // A neighbour no single-line corpus card prints on its own — Kami of
        // Terrible Secrets carries an intervening "if" as well — so the
        // sentence is asserted through a spell that prints only it.
        expect(
            refused(
                sorcery(
                    "Pinned Neighbour",
                    "{1}{B}",
                    "You draw a card and you gain 1 life."
                )
            )
        ).toBe("unparsed");
    });

    it("a discard by the controller is refused: the loot's own choice is another kind", () => {
        expect(
            refused(sorcery("Pinned Self", "{1}{B}", "You discards two cards."))
        ).toBe("unparsed");
    });

    it("an X discard is refused, never lowered to a number it would invent", () => {
        expect(
            refused(
                sorcery(
                    "Pinned Twist",
                    "{X}{B}",
                    "Target player discards X cards."
                )
            )
        ).toBe("unparsed");
    });
});

describe("Player verbs — lowering invariants", () => {
    it("the conjunction keeps its printed order: draw first, then the life loss", () => {
        const def = compiled(
            oracleCard({
                name: "Phyrexian Rager",
                manaCost: "{2}{B}",
                typeLine: "Creature — Phyrexian Horror",
                oracleText:
                    "When this creature enters, you draw a card and you lose 1 life.",
                power: "2",
                toughness: "2",
            })
        );
        const ops = def.compiledTriggeredAbilities![0]!.effects.map(
            (e) => e.op
        );
        expect(ops).toEqual(["draw", "loseLife"]);
    });

    it("the discard is chosen by the player it names, not the controller", () => {
        const def = compiled(
            sorcery("Mind Rot", "{2}{B}", "Target player discards two cards.")
        );
        const [choice, discard] = def.effects!;
        expect(choice).toMatchObject({
            op: "choice",
            player: { target: 0 },
        });
        expect(discard).toMatchObject({
            op: "discard",
            player: { target: 0 },
        });
    });
});
