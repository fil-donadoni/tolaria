// "Exile a <permanent> you control" activation cost (CR 602.1a, 701.13a,
// 109.5).
//
// 1. GOLDEN — a real Oracle line compiled whole (City of Shadows' storage
//    ability).
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const CITY_TEXT =
    "{T}, Exile a creature you control: Put a storage counter on this land.";

function land(oracleText: string) {
    return oracleCard({
        name: "City of Shadows",
        manaCost: "",
        typeLine: "Land",
        oracleText,
    } as never);
}

describe("Exile-a-permanent cost — golden (CR 602.1a, 701.13a)", () => {
    it("City of Shadows: lowers to cost.exileFilter", () => {
        const outcome = compileCard(land(CITY_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities).toEqual([
            {
                id: "city-of-shadows-ability",
                oracleText: CITY_TEXT,
                cost: { tap: true, exileFilter: { types: ["Creature"] } },
                useStack: true,
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "storage",
                        target: { ref: "$source" },
                        count: 1,
                    },
                ],
            },
        ]);
    });

    it('"another" excludes the source (CR 109.2)', () => {
        const atoms = activationCostRule.run(
            "Exile another creature you control",
            parseContext(land(""))
        );
        expect(atoms.ok).toBe(true);
        if (!atoms.ok) return;
        expect(atoms.value.atoms).toEqual([
            {
                kind: "exile-other",
                filter: { types: ["Creature"], excludeSource: true },
            },
        ]);
    });
});

describe("Exile-a-permanent cost — refusals", () => {
    it.each([
        "Exile a creature",
        "Exile a creature an opponent controls",
        "Exile two creatures you control",
        "Exile target creature you control",
    ])("refuses %s", (span) => {
        expect(activationCostRule.run(span, parseContext(land(""))).ok).toBe(
            false
        );
    });
});
