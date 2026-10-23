// "Change the target of target spell with a single target." (CR 115.7a,
// CR 115.7, issue #5259).
//
// Two layers:
//
//  1. GOLDEN forms — real corpus cards compiled whole must produce exactly the
//     Compiled Definition below: the `retarget` Op over an announced spell slot
//     carrying the `spellSingleTarget` filter.
//  2. REFUSALS — neighbouring phrasings this rule must NOT read: a spell or
//     ability subject, a bare "target spell" (the single-target restriction is
//     part of the printed card), and a conditional tail. Each stays refused.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

const TEXT = "Change the target of target spell with a single target.";

describe("change the target of target spell (CR 115.7a)", () => {
    it.each([
        ["Deflection", "{3}{U}"],
        ["Misdirection", "{3}{U}{U}"],
        ["Shunt", "{1}{R}{R}"],
        ["Swerve", "{1}{U}"],
    ])("compiles %s whole", (name, manaCost) => {
        const outcome = compileCard(instant(name, manaCost, TEXT));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const generic = Number(manaCost.match(/^\{(\d)\}/)![1]);
        const expectedCost: Record<string, number> = { X: generic };
        for (const pip of manaCost.match(/\{[A-Z]\}/g)!) {
            const colour = pip[1]!;
            expectedCost[colour] = (expectedCost[colour] ?? 0) + 1;
        }
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name,
                types: ["Instant"],
                manaCost: expectedCost,
                oracleText: TEXT,
                effects: [{ op: "retarget", target: { target: 0 } }],
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    spellSingleTarget: true,
                },
            })
        );
    });

    it.each([
        ["a bare spell subject", "Change the target of target spell."],
        [
            "a spell-or-ability subject",
            "Change the target of target spell or ability with a single target.",
        ],
        [
            "a conditional tail",
            "Change the target of target spell with a single target if that target is you.",
        ],
        [
            "choosing new targets",
            "You may choose new targets for target spell.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(instant("Probe", "{U}", text)).state).toBe(
            "unparsed"
        );
    });
});
