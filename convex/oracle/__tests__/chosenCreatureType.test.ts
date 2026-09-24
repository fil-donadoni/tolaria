// "Choose a creature type other than <type>" + "<subject> becomes that type
// <duration>" (CR 205.3m / 205.1a, issue #4316).
//
//  1. GOLDEN — the three real corpus cards compile whole, the whole
//     Compiled Definition compared (the shared `GOLDEN_FIXTURES` row carries
//     the Unnatural Selection form to the smoke generator).
//  2. REFUSALS — the neighbours the rule must not read, fail-closed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

const LINE_TAIL =
    "Choose a creature type other than Wall. Target creature becomes that type until end of turn.";

function abilityEffects(cost: string, tail = LINE_TAIL) {
    const outcome = compileCard(
        oracleCard({
            name: "Test Card",
            manaCost: "{U}",
            typeLine: "Enchantment",
            power: undefined,
            toughness: undefined,
            oracleText: `${cost}: ${tail}`,
        })
    );
    return outcome;
}

const EXPECTED_EFFECTS = [
    {
        op: "chooseCreatureType",
        player: "controller",
        prompt: "Choose a creature type other than Wall.",
        bind: "$chosenType",
        exclude: ["Wall"],
    },
    {
        op: "setSubtype",
        target: { target: 0 },
        subtypes: { ref: "$chosenType" },
        family: "creature",
        duration: { phase: "end-of-turn" },
    },
];

describe("chosen creature type (CR 205.3m / 205.1a, issue #4316)", () => {
    it.each([
        ["Imagecrafter", "{T}", { X: 0 }],
        ["Mistform Mutant", "{1}{U}", { X: 0 }],
        ["Unnatural Selection", "{1}", { X: 0 }],
    ])("%s: %s compiles to the exclude + setSubtype pair", (name, cost) => {
        const outcome = compileCard(
            oracleCard({
                name,
                manaCost: "{U}",
                typeLine: "Creature — Human Wizard",
                power: "1",
                toughness: "1",
                oracleText: `${cost}: ${LINE_TAIL}`,
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const ability = outcome.definition.activatedAbilities?.[0];
        expect(ability?.effects).toEqual(EXPECTED_EFFECTS);
        expect(ability?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("REFUSES a non-creature type as the exclusion", () => {
        expect(
            abilityEffects(
                "{1}",
                "Choose a creature type other than Forest. Target creature becomes that type until end of turn."
            ).state
        ).toBe("unparsed");
    });

    it("REFUSES the write-back without a duration", () => {
        expect(
            abilityEffects(
                "{1}",
                "Choose a creature type other than Wall. Target creature becomes that type."
            ).state
        ).toBe("unparsed");
    });

    it("never reaches ready when the write-back has no preceding choice", () => {
        // The ref names a binding nothing wrote; the compiled script is
        // quarantined rather than shipped with a dangling read.
        const outcome = abilityEffects(
            "{1}",
            "Target creature becomes that type until end of turn."
        );
        expect(outcome.state).not.toBe("ready");
    });

    it("REFUSES a subject that is not one announced creature", () => {
        expect(
            abilityEffects(
                "{1}",
                "Choose a creature type other than Wall. Target land becomes that type until end of turn."
            ).state
        ).toBe("unparsed");
    });
});
