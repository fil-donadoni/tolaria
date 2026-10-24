// "Exile the top card of your library" activation cost (CR 118.1, 701.13a) and
// the "where X is the exiled card's mana value" amount it feeds (CR 202.3).
//
// 1. GOLDEN — Royal Herbalist (the bare leg beside mana) and Phyrexian
//    Devourer (the leg read back as `sacrificed.manaValue`), compiled whole.
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const HERBALIST_TEXT =
    "{2}, Exile the top card of your library: You gain 1 life.";
const DEVOURER_TEXT =
    "When this creature's power is 7 or greater, sacrifice it.\nExile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.";

describe("Exile-the-top-card cost — golden (CR 118.1, 701.13a)", () => {
    it("Royal Herbalist: lowers to cost.exileTopOfLibrary beside mana", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Royal Herbalist",
                manaCost: "{W}",
                typeLine: "Creature — Human Cleric",
                oracleText: HERBALIST_TEXT,
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities).toEqual([
            {
                id: "royal-herbalist-ability",
                oracleText: HERBALIST_TEXT,
                cost: { mana: { X: 2 }, exileTopOfLibrary: true },
                useStack: true,
                effects: [{ op: "gainLife", amount: 1, player: "controller" }],
            },
        ]);
    });

    it("Phyrexian Devourer: X is the cost snapshot's mana value", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Phyrexian Devourer",
                manaCost: "{6}",
                typeLine: "Artifact Creature — Phyrexian Construct",
                oracleText: DEVOURER_TEXT,
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { ref: "$source" },
                count: { sacrificed: { read: "manaValue" } },
            },
        ]);
    });
});

describe("Exile-the-top-card cost — refusals (fail-closed)", () => {
    it.each([
        "Exile the top two cards of your library",
        "Exile the top card of target player's library",
        "Exile the bottom card of your library",
    ])("refuses the cost %s", (span) => {
        expect(activationCostRule.run(span, parseContext()).ok).toBe(false);
    });

    it("refuses the exiled card's mana value beside a sacrifice leg (one snapshot)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Creature",
                manaCost: "{1}",
                typeLine: "Creature — Construct",
                oracleText:
                    "Sacrifice a creature, Exile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses the exiled card's mana value when the cost exiles nothing", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Creature",
                manaCost: "{1}",
                typeLine: "Creature — Construct",
                oracleText:
                    "{T}: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
