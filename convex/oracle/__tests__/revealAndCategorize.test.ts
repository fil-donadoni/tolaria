// "For each card type, you may put a card of that type from among the revealed
// cards into your hand" (CR 205.2a, CR 608.2c, CR 701.20a): the Grammar Rule
// that lowers a revealed window's per-type pick to `revealAndCategorize`.
//
//  1. GOLDEN — Atraxa, Grand Unifier compiled whole equals its definition.
//  2. REFUSALS — the neighbours the rule does not read.

import { describe, expect, it } from "vitest";
import { CARD_TYPES } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const PICK =
    "For each card type, you may put a card of that type from among the revealed cards into your hand.";
const REST = "Put the rest on the bottom of your library in a random order.";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Window Test",
        manaCost: "{2}{U}",
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("revealAndCategorize — golden (CR 205.2a, CR 701.20a)", () => {
    it("reveal ten + one pick per card type + the rest in a random order: Atraxa's ETB", () => {
        const text = `Reveal the top ten cards of your library. ${PICK} ${REST}`;
        const outcome = compileCard(sorcery(text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Window Test",
                types: ["Sorcery"],
                manaCost: { U: 1, X: 2 },
                oracleText: text,
                effects: [
                    {
                        op: "revealAndCategorize",
                        player: "controller",
                        look: 10,
                        reveal: "window",
                        optional: true,
                        randomBottom: true,
                        categories: CARD_TYPES.map((type) => ({
                            label: type,
                            filter: { type },
                        })),
                        prompt: "Put up to one card of each card type into your hand.",
                    },
                ],
            })
        );
    });
});

describe("revealAndCategorize — refusals (fail-closed)", () => {
    const refused = (text: string) =>
        expect(compileCard(sorcery(text)).state).toBe("unparsed");

    it("a look, not a reveal, has no revealed cards", () =>
        refused(`Look at the top ten cards of your library. ${PICK} ${REST}`));
    it("the pick without a window before it", () => refused(`${PICK} ${REST}`));
    it("the pick without the rest after it", () =>
        refused(`Reveal the top ten cards of your library. ${PICK}`));
    it("the rest in any order, a form no fixture pins", () =>
        refused(
            `Reveal the top ten cards of your library. ${PICK} Put the rest on the bottom of your library in any order.`
        ));
    it("the rest into the graveyard, a form no fixture pins", () =>
        refused(
            `Reveal the top ten cards of your library. ${PICK} Put the rest into your graveyard.`
        ));
    it("a different category list", () =>
        refused(
            `Reveal the top ten cards of your library. For each color, you may put a card of that color from among the revealed cards into your hand. ${REST}`
        ));
});
