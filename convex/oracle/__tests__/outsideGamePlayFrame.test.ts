// "You may play a card you own from outside the game this turn." (CR 400.11b,
// CR 514.2 — Wish, issue #9473).
//
//  1. The GOLDEN fixture — the one accepted form, compiled whole off the real
//     corpus card (Wish) and compared against the entire Compiled Definition.
//  2. REFUSALS — the neighbours this rule does not read: another player, a
//     count, a narrowed card type, a cast-only permission and the
//     bring-to-hand Wish wording (the `bringFromOutsideGame` frame's).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const WISH_TEXT =
    "You may play a card you own from outside the game this turn.";

function sorcery(oracleText: string, name = "Probe Sorcery") {
    return oracleCard({
        name,
        manaCost: "{2}{R}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("play a card from outside the game this turn — golden fixture (CR 400.11b)", () => {
    it("spell slot: Wish", () => {
        const outcome = compileCard(sorcery(WISH_TEXT, "Wish"));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Wish",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 1 },
                oracleText: WISH_TEXT,
                effects: [
                    {
                        op: "grantOutsideGamePlays",
                        player: "controller",
                        count: 1,
                    },
                ],
            })
        );
    });
});

describe("play a card from outside the game this turn — refusals (fail-closed)", () => {
    it.each([
        "Each player may play a card they own from outside the game this turn.",
        "Target player may play a card they own from outside the game this turn.",
        "You may play two cards you own from outside the game this turn.",
        "You may play a land card you own from outside the game this turn.",
        "You may cast a card you own from outside the game this turn.",
        "You may play a card you own from outside the game until your next turn.",
        "You may put a card you own from outside the game into your hand.",
    ])("refuses %s", (text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});
