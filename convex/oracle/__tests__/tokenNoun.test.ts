// The positive noun "token" in the object descriptor (CR 111.1; issue #4534).
//
//  1. GOLDEN — a real corpus card compiled whole: Dogged Hunter's
//     "{T}: Destroy target creature token." reads `isToken: true` on the
//     announced requirement (the positive twin of "nontoken").
//  2. REFUSALS — the converters that cannot carry the flag keep refusing it
//     instead of dropping it: a token in a cost, a token sweep.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const HUNTER_TEXT = "{T}: Destroy target creature token.";

describe("token noun — golden (CR 111.1)", () => {
    it("announced target: Dogged Hunter", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "cf5b3249-619f-48f5-8885-00fd41d24825",
                name: "Dogged Hunter",
                manaCost: "{2}{W}",
                typeLine: "Creature — Human Nomad",
                oracleText: HUNTER_TEXT,
                power: "1",
                toughness: "1",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Dogged Hunter",
                types: ["Creature"],
                subtypes: ["Human", "Nomad"],
                manaCost: { X: 2, W: 1 },
                power: 1,
                toughness: 1,
                oracleText: HUNTER_TEXT,
                activatedAbilities: [
                    {
                        id: "dogged-hunter-ability",
                        oracleText: HUNTER_TEXT,
                        cost: { tap: true },
                        useStack: true,
                        effects: [{ op: "destroy", target: { target: 0 } }],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            isToken: true,
                        },
                    },
                ],
            })
        );
    });
});

describe("token noun — refusals", () => {
    const refused: readonly [string, string, string][] = [
        [
            "a token in an activation cost",
            "Artifact",
            "Sacrifice a token: This creature gets +2/+2 until end of turn.",
        ],
        ["a token sweep", "Sorcery", "Destroy all tokens."],
        [
            "a token sweep in a trigger",
            "Enchantment",
            "At the beginning of your end step, untap all tokens you control.",
        ],
    ];
    it.each(refused)("%s stays unparsed", (_form, typeLine, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                name: "Refusal Probe",
                manaCost: "{1}",
                typeLine,
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
