// The Overload keyword-cost line (CR 702.96a, issue #3274).
//
// Three layers:
//
//  1. GOLDEN — Damn compiled whole: the cost lands in `CardDefinition.overload`
//     and the spell body is the `forEach { set: "targets" }` shape
//     `validateEffectScript` requires, never a `{ target: n }` slot.
//  2. GOLD — the hand-written Damn is exactly what the compiler produces.
//  3. REFUSALS — the neighbours the rule must not read: a cost the payment
//     path is not exercised on, a non-mana cost, a second declaration, a
//     permanent, and a body with no target to change.

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

const DAMN_TEXT =
    'Destroy target creature. A creature destroyed this way can\'t be regenerated.\nOverload {2}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")';

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

describe("Overload [cost] (CR 702.96a)", () => {
    it("Damn: cost on `overload`, body swept over the target set", () => {
        const outcome = compileCard(sorcery("Damn", "{B}{B}", DAMN_TEXT));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Damn",
                types: ["Sorcery"],
                manaCost: { B: 2 },
                oracleText: DAMN_TEXT,
                overload: {
                    id: "overload",
                    description: "Overload {2}{W}{W}",
                    mana: { X: 2, W: 2 },
                },
                targetRequirement: { type: "Creature", count: 1 },
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets" },
                        effects: [
                            {
                                op: "destroy",
                                target: { ref: "$each" },
                                cantBeRegenerated: true,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("gold: the hand-written Damn is what the compiler produces", () => {
        const raw = getAllRawCards().find((c) => c.name === "Damn");
        expect(raw).toBeDefined();
        const outcome = compileCard(sorcery("Damn", "{B}{B}", DAMN_TEXT));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.overload).toEqual(raw!.overload);
        expect(outcome.definition.effects).toEqual(raw!.effects);
    });
});

describe("Overload [cost] — refusals", () => {
    const read = (line: string) => keywordLineSlot.run(line, parseContext());

    it("reads a plain mana cost", () => {
        expect(read("Overload {4}{W}{W}").ok).toBe(true);
    });

    it.each([
        ["a variable {X}", "Overload {X}{W}"],
        ["a hybrid pip", "Overload {2}{W/U}"],
        ["a Phyrexian pip", "Overload {2}{W/P}"],
        ["a non-mana cost", "Overload—Pay 3 life."],
    ])("refuses %s", (_label, line) => {
        expect(read(line).ok).toBe(false);
    });

    it("refuses a second overload line", () => {
        const outcome = compileCard(
            sorcery(
                "Damn",
                "{B}{B}",
                "Destroy target creature.\nOverload {2}{W}{W}\nOverload {3}{W}{W}"
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses an overload spell whose body names no target", () => {
        const outcome = compileCard(
            sorcery("Nothing", "{B}{B}", "Draw a card.\nOverload {2}{W}{W}")
        );
        expect(outcome.state).toBe("unparsed");
    });

    it.each([
        ["a targeted artifact", "Destroy target artifact."],
        ["a sweep", "Destroy all creatures."],
    ])(
        "refuses 'A creature destroyed this way can't be regenerated' behind %s",
        (_label, destroy) => {
            const outcome = compileCard(
                sorcery(
                    "Neighbour",
                    "{B}{B}",
                    `${destroy} A creature destroyed this way can't be regenerated.`
                )
            );
            expect(outcome.state).toBe("unparsed");
        }
    );

    it("refuses overload on a permanent", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bear",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                power: "2",
                toughness: "2",
                oracleText: "Overload {2}{W}{W}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
