// Token creation: "Create <count> P/T <colours> <Subtypes> creature token(s)
// [with <keyword>]" and its "X, where X is that creature's mana value" form
// (CR 111.1 / 111.3 / 202.3 / 608.2h, issue #4125).
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: a single token from a
//     death trigger, a token with a keyword, two two-coloured tokens from an
//     activated ability, and X read off the object a destroy acted on (the
//     bounce form is `GOLDEN_FIXTURES`' Aether Mutation, checked by
//     `goldenFixtures.test.ts`).
//  2. REFUSALS — the neighbours the corpus prints that this rule must not
//     read: an artifact creature token, a colourless one, a named one, two
//     keywords, and Haunted Angel's "exile it and each other player creates".
//  3. LOWERING invariants — what only the sentence walk can decide: which
//     object "that creature" names, and that it names one at all.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sentenceRule } from "../grammar/shared/effectClause";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./fixtures";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
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

describe("create token — golden fixtures (CR 111.1, CR 111.3)", () => {
    it("a single token from a death trigger: Penumbra Bobcat", () => {
        expect(
            compiled({
                oracleId: "f0787397-8edb-4794-8ee1-22f97a057be8",
                name: "Penumbra Bobcat",
                manaCost: "{2}{G}",
                typeLine: "Creature — Cat",
                oracleText:
                    "When this creature dies, create a 2/1 black Cat creature token.",
                power: "2",
                toughness: "1",
                layout: "normal",
            })
        ).toEqual({
            name: "Penumbra Bobcat",
            types: ["Creature"],
            subtypes: ["Cat"],
            manaCost: { X: 2, G: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "When this creature dies, create a 2/1 black Cat creature token.",
            compiledTriggeredAbilities: [
                {
                    id: "penumbra-bobcat-trigger",
                    oracleText:
                        "When this creature dies, create a 2/1 black Cat creature token.",
                    head: { kind: "died", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Cat",
                                types: ["Creature"],
                                subtypes: ["Cat"],
                                power: 2,
                                toughness: 1,
                                colors: ["B"],
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("a token with a keyword (CR 702.1): Penumbra Wurm", () => {
        expect(
            compiled({
                oracleId: "abccb19f-098b-4453-b7bc-838ad5914ebe",
                name: "Penumbra Wurm",
                manaCost: "{5}{G}{G}",
                typeLine: "Creature — Wurm",
                oracleText:
                    "Trample\nWhen this creature dies, create a 6/6 black Wurm creature token with trample.",
                power: "6",
                toughness: "6",
                layout: "normal",
            })
        ).toEqual({
            name: "Penumbra Wurm",
            types: ["Creature"],
            subtypes: ["Wurm"],
            manaCost: { X: 5, G: 2 },
            power: 6,
            toughness: 6,
            oracleText:
                "Trample\nWhen this creature dies, create a 6/6 black Wurm creature token with trample.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "penumbra-wurm-trigger",
                    oracleText:
                        "When this creature dies, create a 6/6 black Wurm creature token with trample.",
                    head: { kind: "died", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Wurm",
                                types: ["Creature"],
                                subtypes: ["Wurm"],
                                power: 6,
                                toughness: 6,
                                colors: ["B"],
                                staticAbilities: ["trample"],
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("two two-coloured, two-subtype tokens (CR 105.1, CR 205.3m): Goblin Trenches", () => {
        expect(
            compiled({
                oracleId: "b43f40e6-c0ad-4a12-b75d-f2ba12629bfe",
                name: "Goblin Trenches",
                manaCost: "{1}{R}{W}",
                typeLine: "Enchantment",
                oracleText:
                    "{2}, Sacrifice a land: Create two 1/1 red and white Goblin Soldier creature tokens.",
                layout: "normal",
            })
        ).toEqual({
            name: "Goblin Trenches",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1, R: 1 },
            oracleText:
                "{2}, Sacrifice a land: Create two 1/1 red and white Goblin Soldier creature tokens.",
            activatedAbilities: [
                {
                    id: "goblin-trenches-ability",
                    oracleText:
                        "{2}, Sacrifice a land: Create two 1/1 red and white Goblin Soldier creature tokens.",
                    cost: {
                        mana: { X: 2 },
                        sacrificeFilter: { types: ["Land"] },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Goblin Soldier",
                                types: ["Creature"],
                                subtypes: ["Goblin", "Soldier"],
                                power: 1,
                                toughness: 1,
                                colors: ["R", "W"],
                            },
                            controller: "controller",
                            count: 2,
                        },
                    ],
                },
            ],
        });
    });

    it("X is the mana value of the creature a destroy acted on (CR 202.3, CR 608.2h): Death Mutation", () => {
        expect(
            compiled({
                oracleId: "6f705338-b00b-4a6d-924f-443e7c5670b7",
                name: "Death Mutation",
                manaCost: "{6}{B}{G}",
                typeLine: "Sorcery",
                oracleText:
                    "Destroy target nonblack creature. It can't be regenerated. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value.",
                layout: "normal",
            })
        ).toEqual({
            name: "Death Mutation",
            types: ["Sorcery"],
            manaCost: { X: 6, B: 1, G: 1 },
            oracleText:
                "Destroy target nonblack creature. It can't be regenerated. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value.",
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                    bind: "$that1",
                },
                {
                    op: "createToken",
                    token: {
                        name: "Saproling",
                        types: ["Creature"],
                        subtypes: ["Saproling"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                    },
                    controller: "controller",
                    count: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeColors: ["B"],
            },
        });
    });
});

describe("create token — refused neighbours (fail-closed)", () => {
    // Each span is a real corpus clause, without its full stop.
    it.each([
        // Nuisance Engine — CR 205.2a: an artifact creature token is a second
        // card type the spec would have to carry.
        [
            "an artifact creature token",
            "Create a 0/1 colorless Pest artifact creature token",
        ],
        // Sliver Queen — "colorless" is not a colour word (CR 105.2c).
        ["a colourless token", "Create a 1/1 colorless Sliver creature token"],
        // Tooth and Claw — CR 111.4: a token NAMED by its creator.
        [
            "a named token",
            "Create a 3/1 red Beast creature token named Carnivore",
        ],
        // Serra the Benevolent — two keywords.
        [
            "two keywords",
            "Create a 4/4 white Angel creature token with flying and vigilance",
        ],
    ])("refuses %s", (_form, span) => {
        expect(sentenceRule.run(span, parseContext()).ok).toBe(false);
    });

    it("refuses a count that disagrees with its noun", () => {
        expect(
            sentenceRule.run(
                "Create two 1/1 green Saproling creature token",
                parseContext()
            ).ok
        ).toBe(false);
        expect(
            sentenceRule.run(
                "Create a 1/1 green Saproling creature tokens",
                parseContext()
            ).ok
        ).toBe(false);
    });

    it('leaves Haunted Angel unparsed: "exile it" on a dies trigger has no selector (issue #4125)', () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "437be0ad-2dd1-42c8-bf62-5af95228b2f8",
                name: "Haunted Angel",
                manaCost: "{2}{W}",
                typeLine: "Creature — Angel",
                oracleText:
                    "Flying\nWhen this creature dies, exile it and each other player creates a 3/3 black Angel creature token with flying.",
                power: "3",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("create token — lowering invariants (CR 608.2h)", () => {
    it('refuses X read off "that creature" when nothing was acted on before it', () => {
        const outcome = compileCard(
            sorcery(
                "Test Card",
                "{3}{G}",
                "Create X 1/1 green Saproling creature tokens, where X is that creature's mana value."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a noun that is not the type of the object acted on", () => {
        const outcome = compileCard(
            sorcery(
                "Test Card",
                "{R}{G}",
                "Destroy target artifact. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('refuses "that creature" when a later sentence targeted another object', () => {
        // Refused today by the one-target limit too; the stale-referent reset
        // in `lowerSentence` is what keeps it refused once that limit lifts.
        const outcome = compileCard(
            sorcery(
                "Test Card",
                "{3}{B}",
                "Destroy target creature. Tap target creature. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("binds the object acted on and reads its mana value when the noun matches", () => {
        const outcome = compileCard(
            sorcery(
                "Test Card",
                "{R}{G}",
                "Destroy target artifact. Create X 1/1 green Saproling creature tokens, where X is that artifact's mana value."
            )
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.effects).toEqual([
            { op: "destroy", target: { target: 0 }, bind: "$that1" },
            expect.objectContaining({
                op: "createToken",
                count: { ref: "$that1.manaValue" },
            }),
        ]);
    });
});
