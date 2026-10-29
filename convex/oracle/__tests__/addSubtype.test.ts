// "<subject> becomes a <Subtype> in addition to its other types" (CR 205.3 +
// CR 613.1d, issue #7369): the clause the `addSubtype` Op is the lowering of.
//
//  1. GOLDEN — the clause as the corpus prints it (Tyrite Sanctum, Olivia
//     Voldaren) on a card shell, the whole Compiled Definition compared.
//  2. REFUSALS — the neighbours the rule must not read, fail-closed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Test Card",
            manaCost: "{1}",
            typeLine: "Creature — Vampire",
            power: "1",
            toughness: "1",
            oracleText,
        })
    );
}

describe("add a subtype indefinitely (CR 205.3 / CR 613.1d, issue #7369)", () => {
    it("activated: a target creature becomes a Vampire", () => {
        const outcome = compile(
            "{2}, {T}: Target creature becomes a Vampire in addition to its other types."
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities).toEqual([
            {
                id: "test-card-ability",
                oracleText:
                    "{2}, {T}: Target creature becomes a Vampire in addition to its other types.",
                cost: { mana: { X: 2 }, tap: true },
                useStack: true,
                effects: [
                    {
                        op: "addSubtype",
                        target: { target: 0 },
                        subtype: "Vampire",
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            },
        ]);
        expect(outcome.opsUsed).toContain("addSubtype");
    });

    it("triggered: a target creature becomes a Vampire", () => {
        const outcome = compile(
            "Whenever this creature attacks, target creature becomes a Vampire in addition to its other types."
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(
            outcome.definition.compiledTriggeredAbilities?.[0]?.effects
        ).toEqual([
            { op: "addSubtype", target: { target: 0 }, subtype: "Vampire" },
        ]);
    });
});

describe("add a subtype — the neighbours it refuses", () => {
    it.each([
        [
            "a non-creature subtype (Memnarch)",
            "{1}{U}{U}: Target permanent becomes an artifact in addition to its other types.",
        ],
        [
            "a printed duration (Thran Forge)",
            "{2}: Until end of turn, target creature becomes a Vampire in addition to its other types.",
        ],
        [
            "an unknown word",
            "{2}, {T}: Target creature becomes a banana in addition to its other types.",
        ],
        [
            "a non-creature target",
            "{2}, {T}: Target land becomes a Vampire in addition to its other types.",
        ],
    ])("refuses %s", (_form, text) => {
        expect(compile(text).state).toBe("unparsed");
    });
});
