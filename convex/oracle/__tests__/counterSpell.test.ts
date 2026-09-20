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

/**
 * WHERE the compiler gave up on a card it refuses — the reason, or the
 * furthest sub-grammar path and the span it could not read.
 *
 * Asserted instead of "it refused somehow", because "somehow" passes for the
 * wrong reason: a refusal test whose card happens to contain a SECOND unread
 * sentence goes on passing after the thing it guards stops guarding.
 */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const gaps = refusal(card);
    if (gaps.length !== 1)
        throw new Error(
            `${card.name}: expected one gap, got ${JSON.stringify(gaps)}`
        );
    const gap = gaps[0]!;
    return gap.attribution === undefined
        ? gap.reason
        : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`;
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
            refusedAt(
                instant(
                    "Jaded Response",
                    "{1}{U}",
                    "Counter target spell if it shares a color with a creature you control."
                )
            )
        ).toBe(
            "effect clause > target filter > object descriptor: spell if it shares a color with a creature you control"
        );
    });

    // A second announced target: `TargetSlots` allows one per effect site
    // (CR 601.2c), so the compound is refused rather than half-read. The
    // printed text names the card; `compileCard` is what replaces it with the
    // self marker, so the fixture goes in as printed.
    it("refuses a counter with a second target — Suffocating Blast", () => {
        expect(
            refusedAt(
                instant(
                    "Suffocating Blast",
                    "{1}{U}{U}{R}",
                    "Counter target spell and Suffocating Blast deals 3 damage to target creature."
                )
            )
        ).toBe(
            "effect clause: Counter target spell and {self} deals 3 damage to target creature"
        );
    });

    // A FLAT tax is a different `mayPay` cost leg (a literal `ManaCost`), so
    // the Domain form is no evidence for it.
    it("refuses a flat tax — Mana Leak", () => {
        expect(
            refusedAt(
                instant(
                    "Mana Leak",
                    "{1}{U}",
                    "Counter target spell unless its controller pays {3}."
                )
            )
        ).toBe(
            "effect clause: Counter target spell unless its controller pays {3}"
        );
    });

    // The Domain tax's PRICE is the literal {1} — the one amount printed. A
    // captured amount would be an accepted form with no fixture, and {0}
    // would lower to a counterspell that never counters.
    it("refuses a per-land-type tax at any other price", () => {
        expect(
            refusedAt(
                instant(
                    "Evasive Action",
                    "{1}{U}",
                    "Counter target spell unless its controller pays {2} for each basic land type among lands you control."
                )
            )
        ).toBe(
            "effect clause: Counter target spell unless its controller pays {2} for each basic land type among lands you control"
        );
    });

    // CR 112.1 — a spell is a CARD on the stack; an activated or triggered
    // ability on the stack (CR 113.7a) is not one, so it is not what this
    // rule's `{ type: "spell" }` slot announces.
    it("refuses countering an ability — Stifle", () => {
        expect(
            refusedAt(
                instant(
                    "Stifle",
                    "{U}",
                    "Counter target activated or triggered ability."
                )
            )
        ).toBe(
            "effect clause > target filter > object descriptor: activated or triggered ability"
        );
    });

    // A NARROWED spell target announces a smaller set than
    // `{ type: "spell" }` describes.
    it("refuses a narrowed spell target — Thoughtbind", () => {
        expect(
            refusedAt(
                instant(
                    "Thoughtbind",
                    "{2}{U}",
                    "Counter target spell with mana value 4 or less."
                )
            )
        ).toBe(
            "effect clause > target filter > object descriptor: spell with mana value 4 or less"
        );
    });
});

// CR 112.1 / CR 110.1 — teaching the target grammar the phrase "target spell"
// handed EVERY verb a stack object, and gold caught the first casualty:
// Reprieve compiled its CR 400.7 stack departure (`moveSpellFromStack`, issue
// #2605) as a permanent's `moveZone`. The refusal lives at `objectSelector`,
// the one chokepoint every battlefield verb passes — so the guard is written
// over the CLASS, not over the card that exposed it.
describe("no battlefield verb reads a spell (CR 112.1)", () => {
    const ON_THE_STACK =
        "a spell is on the stack, not the battlefield (CR 112.1)";

    it.each([
        ["destroy", "Destroy target spell."],
        ["tap", "Tap target spell."],
        ["untap", "Untap target spell."],
        ["regenerate", "Regenerate target spell."],
        ["bounce", "Return target spell to its owner's hand."],
        ["pump", "Target spell gets +1/+1 until end of turn."],
        ["grant", "Target spell gains flying until end of turn."],
        ["counters", "Put two +1/+1 counters on target spell."],
        ["damage", "Bolt Probe deals 2 damage to target spell."],
    ])("refuses %s", (_verb, oracleText) => {
        expect(refusedAt(instant("Bolt Probe", "{1}{U}", oracleText))).toBe(
            ON_THE_STACK
        );
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
