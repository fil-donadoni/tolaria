// Counterspells: "Counter target spell" and CR 118.12a's punisher half
// (CR 701.6a, issue #4129).
//
// Four layers, each watching a different way this family can go wrong:
//
//  1. GOLDEN forms — a real corpus card compiled whole must produce exactly
//     the Compiled Definition below: the bare counter at the spell site, the
//     same counter as a trigger's body, the optional "you may counter", and
//     the Domain-taxed counter under CR 207.2c's ability word.
//  2. REFUSALS — the neighbouring forms this rule must NOT read: a resolution
//     condition on the counter, a second announced target, a flat tax, an
//     ability on the stack, and a narrowed spell target. Each is a printed
//     card, and each stays refused under its own Grammar Gap key.
//  3. The TARGET phrase — "target spell" is exactly one spelling, and no
//     battlefield verb may read it (a spell is on the stack, CR 112.1).
//  4. The ABILITY WORD — CR 207.2c words are dropped from the head of a
//     sentence, and an em dash that is not one keeps every word it printed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

function creature(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Creature — Snake",
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The gap attributions of a card the compiler refuses. */
function refusal(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    return outcome.gaps;
}

describe("counter target spell (CR 701.6a)", () => {
    it("compiles the bare spell — Counterspell, whole", () => {
        expect(
            sortKeys(
                compiled(
                    instant("Counterspell", "{U}{U}", "Counter target spell.")
                )
            )
        ).toEqual(
            sortKeys({
                name: "Counterspell",
                types: ["Instant"],
                manaCost: { U: 2 },
                oracleText: "Counter target spell.",
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });

    it("compiles the same counter as a trigger's body — Mystic Snake", () => {
        const definition = compiled(
            creature(
                "Mystic Snake",
                "{1}{G}{U}{U}",
                "Flash\nWhen this creature enters, counter target spell."
            )
        );
        expect(definition.compiledTriggeredAbilities).toEqual([
            {
                id: "mystic-snake-trigger",
                oracleText: "When this creature enters, counter target spell.",
                head: { kind: "entered", scope: "self" },
                targetRequirement: { type: "spell", count: 1 },
                effects: [{ op: "counter", target: { target: 0 } }],
            },
        ]);
    });

    // CR 603.2 — the optional trigger's decision is the cost-free `mayPay`
    // (issue #680); the counter is its `if` body, read at trigger casing.
    it("reads the optional counter — Frilled Mystic's 'you may counter'", () => {
        const definition = compiled(
            creature(
                "Frilled Mystic",
                "{G}{G}{U}{U}",
                "Flash\nWhen this creature enters, you may counter target spell."
            )
        );
        expect(definition.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "mayPay",
                player: "controller",
                prompt: "Counter target spell?",
                bind: "$may1",
            },
            {
                op: "if",
                predicate: { binding: "$may1" },
                then: [{ op: "counter", target: { target: 0 } }],
            },
        ]);
    });

    // CR 118.12a — "[counter] unless [its controller pays]" MEANS "they may
    // pay; if they don't, counter it", and the Domain price is the generic
    // tally leg (`genericEqualTo`), read off the SPELL's controller.
    it("compiles the Domain-taxed counter — Evasive Action, whole", () => {
        const oracleText =
            "Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.";
        expect(
            sortKeys(compiled(instant("Evasive Action", "{1}{U}", oracleText)))
        ).toEqual(
            sortKeys({
                name: "Evasive Action",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText,
                effects: [
                    {
                        op: "mayPay",
                        player: { controllerOf: { target: 0 } },
                        cost: {
                            genericEqualTo: { domain: { of: "controller" } },
                        },
                        prompt: "Pay {1} for each basic land type among lands Evasive Action's controller controls to prevent your spell from being countered?",
                        bind: "$may1",
                    },
                    {
                        op: "if",
                        predicate: { not: { binding: "$may1" } },
                        then: [{ op: "counter", target: { target: 0 } }],
                    },
                ],
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });
});

describe("the neighbours this rule refuses (fail-closed, ADR 0105 § 2)", () => {
    // A resolution-time condition on the counter: `sharesColor` reads two
    // OBJECTS on the battlefield and answers false for a spell, and "a
    // creature you control" is an existential no predicate expresses.
    it("refuses a counter gated on a resolution condition — Jaded Response", () => {
        expect(
            refusal(
                instant(
                    "Jaded Response",
                    "{1}{U}",
                    "Counter target spell if it shares a color with a creature you control."
                )
            )
        ).not.toEqual([]);
    });

    // A second announced target: `TargetSlots` allows one per effect site
    // (CR 601.2c), so the compound is refused rather than half-read.
    it("refuses a counter with a second target — Suffocating Blast", () => {
        expect(
            refusal(
                instant(
                    "Suffocating Blast",
                    "{1}{U}{U}{R}",
                    "Counter target spell and {self} deals 3 damage to target creature."
                )
            )
        ).not.toEqual([]);
    });

    // A FLAT tax is a different `mayPay` cost leg (a literal `ManaCost`), so
    // the Domain form is no evidence for it.
    it("refuses a flat tax — Mana Leak", () => {
        expect(
            refusal(
                instant(
                    "Mana Leak",
                    "{1}{U}",
                    "Counter target spell unless its controller pays {3}."
                )
            )
        ).not.toEqual([]);
    });

    // CR 112.1 — a spell is a CARD on the stack; an activated or triggered
    // ability on the stack (CR 113.7a) is not one, so it is not what this
    // rule's `{ type: "spell" }` slot announces.
    it("refuses countering an ability — 'target activated or triggered ability'", () => {
        expect(
            refusal(
                instant(
                    "Stifle",
                    "{U}",
                    "Counter target activated or triggered ability."
                )
            )
        ).not.toEqual([]);
    });

    // A NARROWED spell target ("with mana value 3 or less") announces a
    // smaller set than `{ type: "spell" }` describes.
    it("refuses a narrowed spell target — 'target spell with mana value 3 or less'", () => {
        expect(
            refusal(
                instant(
                    "Hindering Light",
                    "{U}",
                    "Counter target spell with mana value 3 or less."
                )
            )
        ).not.toEqual([]);
    });

    // CR 112.1 / CR 400.7 — a spell leaving the stack WITHOUT being countered
    // is `moveSpellFromStack` (issue #2605), not a permanent's `moveZone`.
    // Reading it as one compiled Reprieve into a different spell.
    it("refuses a battlefield verb on a spell target — Reprieve's bounce", () => {
        expect(
            refusal(
                instant(
                    "Reprieve",
                    "{1}{W}",
                    "Return target spell to its owner's hand.\nDraw a card."
                )
            )
        ).not.toEqual([]);
    });
});

describe("CR 207.2c — an ability word is decoration", () => {
    it("drops the word and reads the ability it heads", () => {
        const withWord = compiled(
            instant(
                "Evasive Action",
                "{1}{U}",
                "Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control."
            )
        );
        const without = compiled(
            instant(
                "Evasive Action",
                "{1}{U}",
                "Counter target spell unless its controller pays {1} for each basic land type among lands you control."
            )
        );
        expect(withWord.effects).toEqual(without.effects);
    });

    // The head must be the WHOLE span before the separator AND a member of
    // the CR census — an em dash elsewhere is not a licence to drop words.
    it("keeps a head that is not one of the CR's ability words", () => {
        expect(
            refusal(
                instant(
                    "Not A Word",
                    "{1}{U}",
                    "Counterspelling — Counter target spell."
                )
            )
        ).not.toEqual([]);
    });
});
