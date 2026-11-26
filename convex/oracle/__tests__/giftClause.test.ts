// A spell's clauses that read its gift's promise (CR 702.174k / 702.174m).
//
//  1. GOLDEN fixtures — the seven corpus cards, compiled whole and `ready`.
//  2. REFUSALS — the neighbours these rules must not read (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

const GIFT = "Gift a card\n";

function stateOf(typeLine: string, oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Test Gift Spell",
            manaCost: "{1}{G}",
            typeLine,
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    ).state;
}

describe("Gift clauses — golden fixtures (CR 702.174k/m)", () => {
    it.each([
        // "If the gift was promised, instead …" — one swapped announcement.
        "Into the Flood Maw",
        "Long River's Pull",
        // … to an exact pair.
        "Wear Down",
        "Peerless Recycling",
        // … where only the promised clause announces a target.
        "Wildfire Howl",
        // "If the gift wasn't promised, …".
        "Nocturnal Hunger",
        "Parting Gust",
    ])("%s", (name) => {
        const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
        expect(fixture?.rule).toBe("gift sentence");
        const outcome = compileCard(fixture!.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture!.expected)
        );
    });
});

describe("Gift clauses — refusals (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // "Instead" does not say how many of two instructions it replaces.
        GIFT +
            "Draw a card. Destroy target creature. If the gift was promised, instead destroy target permanent.",
        // No effect in front to replace.
        GIFT + "If the gift was promised, instead draw a card.",
        // A target only the unpromised side names has no encoding.
        GIFT +
            "Destroy target creature. If the gift was promised, instead draw two cards.",
        GIFT +
            "Draw a card. If the gift wasn't promised, destroy target creature.",
        // Two groups on the promised side.
        GIFT +
            "Destroy target artifact. If the gift was promised, instead destroy target artifact and target enchantment.",
        // A clause that reads the promise on a card with no gift.
        "Destroy target creature. If the gift wasn't promised, you lose 2 life.",
        "Counter target creature spell. If the gift was promised, instead counter target spell.",
        // A gift is not a kicker (CR 702.33d).
        GIFT + "Draw a card. If this spell was kicked, draw a card.",
        // The exact pair is read inside the promised clause only.
        "Destroy two target artifacts and/or enchantments.",
        "Return two target permanent cards from your graveyard to your hand.",
        GIFT +
            "Destroy two target artifacts and/or enchantments. If the gift was promised, instead destroy target permanent.",
        GIFT +
            "Destroy target artifact. If the gift was promised, instead destroy two target artifacts or enchantments.",
        GIFT +
            "Exile target creature card from your graveyard. If the gift was promised, instead exile two target creature cards from your graveyard.",
        // Nothing follows the replaced effect: its announced object is two.
        GIFT +
            "Destroy target creature. If the gift was promised, instead destroy target permanent. Draw a card.",
        // A nearby count nobody prints.
        GIFT +
            "Destroy target artifact. If the gift was promised, instead destroy three target artifacts and/or enchantments.",
        // The counter rider names one card and one counter.
        "Exile target nontoken creature. Return it to the battlefield under its owner's control with a +1/+1 counter on it at the beginning of the next end step.",
        "Exile target nontoken creature. Return that card to the battlefield under its owner's control with two +1/+1 counters on it at the beginning of the next end step.",
        // The two-amount damage pins both recipients.
        "Test Gift Spell deals 1 damage to any target and 2 damage to each player.",
        "Test Gift Spell deals 1 damage to target creature and 2 damage to each creature.",
    ])("%s", (oracleText) => {
        expect(stateOf("Sorcery", oracleText)).toBe("unparsed");
    });

    it("an ability site reads no gift clause of its own spell's kind", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Gift Bear",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                oracleText:
                    GIFT +
                    "When this creature enters, draw a card. If the gift was promised, instead draw two cards.",
                power: "2",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
