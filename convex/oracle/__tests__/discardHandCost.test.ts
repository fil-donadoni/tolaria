// "Discard your hand" activation cost (CR 701.9a, 118.3).
//
// 1. GOLDEN — a real Oracle row compiled whole (Reverberating Summons), plus
//    the cost spans of the corpus cards whose effect clause is a separate gap
//    (Lion's Eye Diamond, Null Brooch) read through the cost rule alone.
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const SUMMONS_TEXT =
    "{1}{R}, Discard your hand, Sacrifice this enchantment: Draw two cards.";

function enchantment(oracleText: string) {
    return oracleCard({
        name: "Reverberating Summons",
        manaCost: "{1}{R}",
        typeLine: "Enchantment",
        oracleText,
    });
}

function artifact(oracleText: string) {
    return oracleCard({
        name: "Source",
        manaCost: "{2}",
        typeLine: "Artifact",
        oracleText,
    });
}

describe("Discard-your-hand cost — golden (CR 701.9a, 118.3)", () => {
    it("Reverberating Summons: lowers to cost.discardAtRandom beside mana and sacrifice", () => {
        const outcome = compileCard(enchantment(SUMMONS_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Reverberating Summons",
            types: ["Enchantment"],
            manaCost: { X: 1, R: 1 },
            oracleText: SUMMONS_TEXT,
            activatedAbilities: [
                {
                    id: "reverberating-summons-ability",
                    oracleText: SUMMONS_TEXT,
                    cost: {
                        mana: { X: 1, R: 1 },
                        discardAtRandom: 99,
                        sacrifice: true,
                    },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 2 }],
                },
            ],
        });
    });

    it.each([
        ["Discard your hand, Sacrifice this artifact", 2],
        ["{2}, {T}, Discard your hand", 3],
    ])("%s reads one discard atom", (span, atoms) => {
        const parsed = activationCostRule.run(span, parseContext(artifact("")));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.atoms).toHaveLength(atoms);
        expect(
            parsed.value.atoms.filter((a) => a.kind === "discard-at-random")
        ).toEqual([{ kind: "discard-at-random", count: 99 }]);
    });
});

describe("Discard-your-hand cost — refusals", () => {
    it.each([
        "Discard your hand and graveyard",
        "Discard their hand",
        "Discard your hands",
        "Discard your hand at random",
    ])("refuses %s", (span) => {
        expect(
            activationCostRule.run(span, parseContext(artifact(""))).ok
        ).toBe(false);
    });

    it("a spell additional cost does not encode it (stays unparsed)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Source",
                manaCost: "{2}{R}",
                typeLine: "Sorcery",
                oracleText:
                    "As an additional cost to cast this spell, discard your hand.\nDraw two cards.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
