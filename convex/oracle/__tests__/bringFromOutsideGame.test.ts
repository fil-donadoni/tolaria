// "You may reveal a sorcery card you own from outside the game and put it
// into your hand." (CR 400.11b, CR 701.20a — the Wish cards, issue #6523).
//
//  1. The GOLDEN fixture — the one accepted form, compiled whole off the real
//     corpus card the gap held (Burning Wish) and compared against the entire
//     Compiled Definition. No `GOLDEN_FIXTURES` row: the Op's smoke skip is
//     `suspends-for-input`, an op-covered class, so nothing card-dependent
//     withholds the card from `ready`.
//  2. REFUSALS — the neighbours this rule does not read: the sibling Wish
//     descriptions (each its own gap until a row earns it), the "named
//     {self}" form, and the no-reveal "put … into your hand" wording.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const BURNING_WISH_TEXT =
    "You may reveal a sorcery card you own from outside the game and put it into your hand. Exile Burning Wish.";

const BURNING_WISH = oracleCard({
    name: "Burning Wish",
    manaCost: "{1}{R}",
    typeLine: "Sorcery",
    oracleText: BURNING_WISH_TEXT,
});

describe("Bring a card in from outside the game — golden fixture (CR 400.11b, CR 701.20a)", () => {
    it("spell slot: Burning Wish", () => {
        const outcome = compileCard(BURNING_WISH);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Burning Wish",
                types: ["Sorcery"],
                manaCost: { X: 1, R: 1 },
                oracleText: BURNING_WISH_TEXT,
                effects: [
                    {
                        op: "bringFromOutsideGame",
                        player: "controller",
                        filter: { type: "Sorcery" },
                        prompt: "Reveal a sorcery card you own from outside the game.",
                    },
                    { op: "exileSelf" },
                ],
            })
        );
    });

    it("reaches ready", () => {
        expect(compileCard(BURNING_WISH).state).toBe("ready");
    });
});

describe("Bring a card in from outside the game — refused neighbours (fail-closed)", () => {
    const refused = (name: string, typeLine: string, oracleText: string) =>
        compileCard(
            oracleCard({ name, manaCost: "{1}{U}", typeLine, oracleText })
        ).state;

    it("a description with no row (Cunning Wish's instant card)", () => {
        expect(
            refused(
                "Cunning Wish",
                "Instant",
                "You may reveal an instant card you own from outside the game and put it into your hand. Exile Cunning Wish."
            )
        ).toBe("unparsed");
    });

    it('the no-reveal wording ("put a card you own from outside the game")', () => {
        expect(
            refused(
                "Death Wish",
                "Sorcery",
                "You may put a card you own from outside the game into your hand. You lose half your life, rounded up. Exile Death Wish."
            )
        ).toBe("unparsed");
    });

    it('the mandatory, name-restricted form ("Reveal a card you own named …")', () => {
        expect(
            refused(
                "Test Wish",
                "Sorcery",
                "Reveal a card you own named Test Wish from outside the game and put it into your hand."
            )
        ).toBe("unparsed");
    });
});
