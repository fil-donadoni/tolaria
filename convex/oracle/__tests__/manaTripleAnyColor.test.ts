// Mana ability: "Add three mana of any one color. Activate only as an instant."
// (CR 605.1a / 106.1a / 605.3b) — Lion's Eye Diamond, Diamond Lion.
//
// 1. GOLDEN — real corpus rows compiled whole.
// 2. GOLD — Lion's Eye Diamond compiles back into its shipped definition.
// 3. REFUSALS — neighbours stay `unparsed` (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import { lionsEyeDiamond } from "../../cards/sets/mir/colorless.cards";
import { oracleCard } from "./oracle.fixture";

const TRIPLES = [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }];

const LED_TEXT =
    "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.";
const LION_TEXT =
    "{T}, Discard your hand, Sacrifice this creature: Add three mana of any one color. Activate only as an instant.";

function led(oracleText: string) {
    return oracleCard({
        name: "Lion's Eye Diamond",
        manaCost: "{0}",
        typeLine: "Artifact",
        oracleText,
    });
}

describe("three mana of any one color (CR 605.1a, 106.1a, 605.3b)", () => {
    it("Lion's Eye Diamond: choice of five triples, stackless, discard + sacrifice cost", () => {
        const outcome = compileCard(led(LED_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const ability = outcome.definition.activatedAbilities?.[0];
        expect(sortKeys(ability)).toEqual(
            sortKeys({
                id: "lion-s-eye-diamond-mana",
                oracleText: LED_TEXT,
                cost: { discardAtRandom: 99, sacrifice: true },
                useStack: false,
                manaChoices: TRIPLES,
            })
        );
    });

    it("Diamond Lion: tap beside discard and sacrifice", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Diamond Lion",
                manaCost: "{3}",
                typeLine: "Artifact Creature — Cat",
                power: "2",
                toughness: "2",
                oracleText: LION_TEXT,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const ability = outcome.definition.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({
            tap: true,
            discardAtRandom: 99,
            sacrifice: true,
        });
        expect(ability?.manaChoices).toEqual(TRIPLES);
        expect(ability?.useStack).toBe(false);
    });

    it("gold: Lion's Eye Diamond round-trips from its own text", () => {
        expect(sortKeys(roundTripCard(lionsEyeDiamond()).verdict)).toEqual({
            ok: true,
            kind: "equal",
        });
    });
});

describe("three mana of any one color — refusals", () => {
    it.each([
        ["each mana picked separately", "Add three mana of any color"],
        ["two of one color", "Add two mana of any one color"],
        [
            "other instant-speed rider text",
            "Add three mana of any one color. Activate only during your turn",
        ],
    ])("%s stays unparsed", (_label, effect) => {
        const text = `Discard your hand, Sacrifice this artifact: ${effect}.`;
        expect(compileCard(led(text)).state).toBe("unparsed");
    });

    it("the instant-only rider after a non-mana-ability shape is not read as one", () => {
        const text =
            "Discard your hand, Sacrifice this artifact: Add {R}{R}{R}. Activate only as an instant.";
        const outcome = compileCard(led(text));
        // fixed production + instant rider: accepted as a no-op rider
        expect(outcome.state).toBe("ready");
    });
});
