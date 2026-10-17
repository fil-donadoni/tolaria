// "You may draw N additional cards. If you do, choose M cards in your hand
// drawn this turn. For each of those cards, pay L life or put the card on top
// of your library." — the Grammar Rule that emits `rangedTopdeck` (CR 121.1,
// CR 119.4, CR 401.4, issue #5689).
//
// The positive form is the Sylvan Library golden below; every refusal is a
// neighbour of that text that must NOT compile (ADR 0105 § 2 — fail-closed):
// the three sentences are one form, and either one alone, out of order, or
// with another payer prices something the Op does not do.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const HEAD = "At the beginning of your draw step,";
const MAY = "you may draw two additional cards.";
const CHOOSE = "If you do, choose two cards in your hand drawn this turn.";
const PAY =
    "For each of those cards, pay 4 life or put the card on top of your library.";

function enchantment(oracleText: string, name = "Test Library") {
    return oracleCard({
        name,
        manaCost: "{1}{G}",
        typeLine: "Enchantment",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("ranged topdeck grammar (CR 121.1, CR 119.4, CR 401.4)", () => {
    it("Sylvan Library compiles to a mayPay-gated draw + rangedTopdeck", () => {
        const text = `${HEAD} ${MAY} ${CHOOSE} ${PAY}`;
        const outcome = compileCard(enchantment(text, "Sylvan Library"));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Sylvan Library",
                types: ["Enchantment"],
                manaCost: { X: 1, G: 1 },
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "sylvan-library-trigger",
                        oracleText: text,
                        head: { kind: "phase", phase: "DRAW", scope: "your" },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Draw two additional cards?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "draw",
                                        player: "controller",
                                        count: 2,
                                    },
                                    {
                                        op: "rangedTopdeck",
                                        player: "controller",
                                        pool: "drawn-this-turn",
                                        max: 2,
                                        costPerKept: 4,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
        expect(outcome.opsUsed).toContain("rangedTopdeck");
    });

    it.each([
        ["the draw with no pick", `${HEAD} ${MAY}`],
        ["the draw and the pick with no price", `${HEAD} ${MAY} ${CHOOSE}`],
        ["the draw with a price but no pick", `${HEAD} ${MAY} ${PAY}`],
        ["a pick with no draw", `${HEAD} ${CHOOSE} ${PAY}`],
        ["a price with no draw", `${HEAD} ${PAY}`],
        ["the pick and price out of order", `${HEAD} ${MAY} ${PAY} ${CHOOSE}`],
        [
            "a mandatory draw",
            `${HEAD} draw two additional cards. ${CHOOSE} ${PAY}`,
        ],
        [
            "a pick among cards not drawn this turn",
            `${HEAD} ${MAY} If you do, choose two cards in your hand. ${PAY}`,
        ],
        [
            "a price that is not life",
            `${HEAD} ${MAY} ${CHOOSE} For each of those cards, discard a card or put the card on top of your library.`,
        ],
        [
            "a placement that is not the top of the library",
            `${HEAD} ${MAY} ${CHOOSE} For each of those cards, pay 4 life or put the card on the bottom of your library.`,
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(enchantment(text)).state).toBe("unparsed");
    });
});
