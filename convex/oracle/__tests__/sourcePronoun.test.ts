// The pronoun subject: "It deals …" / "it gets …" opening an ability's effect,
// bound to the ability's SOURCE where — and only where — the site printed that
// antecedent (CR 608.2h, issue #4124).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: the activated site whose
//     cost names the source (a sacrifice, a counter removal), and the
//     triggered site whose head's subject is the source (attacks, dies).
//  2. The kicked spell — "If this spell was kicked, it deals …" binds the
//     pronoun to the spell; Jilt is still unparsed, but on its SECOND target,
//     not on the pronoun.
//  3. REFUSALS — every neighbour whose antecedent is not the source: a cost
//     that names no object, a trigger head about another creature, a tail
//     behind an intervening-if, a kicked "it" that is not dealing damage, and
//     a pronoun opening a LATER sentence (it names that sentence's object).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { Rule } from "../rule";
import type { SlotIR } from "../grammar/ir";
import { activatedSlot } from "../grammar/slots/activated";
import { spellSlot } from "../grammar/slots/spell";
import { triggeredSlot } from "../grammar/slots/triggered";
import { oracleCard, parseContext } from "./fixtures";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function unparsedSpan(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled: ${outcome.state}`);
    return outcome.gaps.map((g) => g.attribution?.span);
}

describe("pronoun subject — golden fixtures (CR 608.2h)", () => {
    it("activated, sacrifice cost: Mogg Fanatic's 'It deals 1 damage to any target'", () => {
        const card = oracleCard({
            name: "Mogg Fanatic",
            manaCost: "{R}",
            typeLine: "Creature — Goblin",
            oracleText:
                "Sacrifice this creature: It deals 1 damage to any target.",
            power: "1",
            toughness: "1",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Mogg Fanatic",
                types: ["Creature"],
                subtypes: ["Goblin"],
                manaCost: { R: 1 },
                power: 1,
                toughness: 1,
                oracleText:
                    "Sacrifice this creature: It deals 1 damage to any target.",
                activatedAbilities: [
                    {
                        id: "mogg-fanatic-ability",
                        oracleText:
                            "Sacrifice this creature: It deals 1 damage to any target.",
                        cost: { sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 1,
                                to: { target: 0 },
                            },
                        ],
                        targetRequirement: { type: "any", count: 1 },
                    },
                ],
            })
        );
    });

    it("activated, counter-removal cost: Sawtooth Thresher's 'It gets +4/+4'", () => {
        const text =
            "Remove two +1/+1 counters from this creature: It gets +4/+4 until end of turn.";
        const card = oracleCard({
            name: "Sawtooth Thresher",
            manaCost: "{6}",
            typeLine: "Artifact Creature — Construct",
            oracleText: text,
            power: "1",
            toughness: "1",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Sawtooth Thresher",
                types: ["Artifact", "Creature"],
                subtypes: ["Construct"],
                manaCost: { X: 6 },
                power: 1,
                toughness: 1,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "sawtooth-thresher-ability",
                        oracleText: text,
                        cost: { removeCounter: { type: "+1/+1", count: 2 } },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 4,
                                toughness: 4,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("triggered, attacks head: Flowstone Charger's 'it gets +3/-3'", () => {
        const text =
            "Whenever this creature attacks, it gets +3/-3 until end of turn.";
        const card = oracleCard({
            name: "Flowstone Charger",
            manaCost: "{2}{R}{W}",
            typeLine: "Creature — Beast",
            oracleText: text,
            power: "2",
            toughness: "5",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Flowstone Charger",
                types: ["Creature"],
                subtypes: ["Beast"],
                manaCost: { X: 2, W: 1, R: 1 },
                power: 2,
                toughness: 5,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "flowstone-charger-trigger",
                        oracleText: text,
                        head: { kind: "attacks" },
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 3,
                                toughness: -3,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("triggered, dies head: Pitchburn Devils' 'it deals 3 damage to any target'", () => {
        const text =
            "When this creature dies, it deals 3 damage to any target.";
        const card = oracleCard({
            name: "Pitchburn Devils",
            manaCost: "{4}{R}",
            typeLine: "Creature — Devil",
            oracleText: text,
            power: "3",
            toughness: "3",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Pitchburn Devils",
                types: ["Creature"],
                subtypes: ["Devil"],
                manaCost: { X: 4, R: 1 },
                power: 3,
                toughness: 3,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "pitchburn-devils-trigger",
                        oracleText: text,
                        head: { kind: "died", scope: "self" },
                        targetRequirement: { type: "any", count: 1 },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 3,
                                to: { target: 0 },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("pronoun subject — the kicked spell (CR 702.33e)", () => {
    it("Jilt: 'it deals' is read as the spell; the gap moves to the second target", () => {
        const card = oracleCard({
            name: "Jilt",
            manaCost: "{1}{U}",
            typeLine: "Instant",
            oracleText:
                "Kicker {1}{R} (You may pay an additional {1}{R} as you cast this spell.)\nReturn target creature to its owner's hand. If this spell was kicked, it deals 2 damage to another target creature.",
            power: undefined,
            toughness: undefined,
        });
        expect(unparsedSpan(card)).toEqual(["another target creature"]);
    });
});

describe("pronoun subject — refusals (no antecedent is the source)", () => {
    // Each refusal is asserted on the SLOT's own reason, so a future unrelated
    // gap cannot keep these green: the line must fail on the pronoun guard.
    function reason(
        slot: Rule<SlotIR>,
        line: string,
        typeLine = "Creature — Bear"
    ) {
        const card = oracleCard({ oracleText: line, typeLine });
        const parsed = slot.run(line, parseContext(card));
        if (parsed.ok) throw new Error(`${line} parsed`);
        return parsed.reason;
    }

    it("a cost that names no object leaves 'It' unbound", () => {
        expect(
            reason(activatedSlot, "{1}: It gets +1/+1 until end of turn.")
        ).toContain("the cost names no source");
    });

    it("a trigger about ANOTHER creature: 'it' is the entering creature, not the source", () => {
        expect(
            reason(
                triggeredSlot,
                "Whenever another creature you control enters, it gets +1/+1 until end of turn."
            )
        ).toContain("the trigger's subject is not the source");
    });

    it("behind an intervening-if the condition is the nearer antecedent", () => {
        expect(
            reason(
                triggeredSlot,
                "When this creature enters, if you control a Goblin, it gets +1/+1 until end of turn."
            )
        ).toContain("after an intervening-if clause");
    });

    it("a pronoun opening a LATER sentence names that sentence's object (Rosa, Resolute White Mage)", () => {
        const outcome = compileCard(
            oracleCard({
                oracleText:
                    "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control. It gains lifelink until end of turn.",
            })
        );
        expect(
            outcome.state === "unparsed" &&
                outcome.gaps.map((g) => g.attribution?.span)
        ).toEqual(["It"]);
    });

    it("after a kicked condition 'it' is the spell only as a damage source", () => {
        expect(
            reason(
                spellSlot,
                "Target creature gets +1/+1 until end of turn. If this spell was kicked, it gains flying until end of turn.",
                "Instant"
            )
        ).toContain("only as a damage source");
    });
});
