// The positive noun "token" in the object descriptor (CR 111.1).
//
//  1. GOLDEN — real corpus cards compiled whole, one per slot that reads the
//     noun: the announced target (Dogged Hunter), an activation cost bare and
//     subtyped (Glimmer Bairn, Diamond Kaleidoscope) and a determiner-less
//     token group (Bloodline Culling). The "all … tokens" / "nontoken" sweeps
//     are `GOLDEN_FIXTURES` rows (Crisis of Conscience, Perplexing Test).
//  2. CONDITION — "if you control a token" / "three or more tokens" read as a
//     counted `isToken` controls gate; no corpus body around it compiles yet.
//  3. REFUSALS — the neighbours the noun does not license.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { conditionRule } from "../grammar/shared/condition";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

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

function compiledDefinition(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return sortKeys(outcome.definition);
}

const BAIRN_TEXT =
    "Sacrifice a token: This creature gets +2/+2 until end of turn.";
const KALEIDOSCOPE_TEXT =
    "{3}, {T}: Create a 0/1 colorless Prism artifact creature token.\nSacrifice a Prism token: Add one mana of any color.";
const CULLING_TEXT =
    "Choose one —\n• Target creature gets -5/-5 until end of turn.\n• Creature tokens get -2/-2 until end of turn.";

describe("token noun in an activation cost — golden (CR 111.1)", () => {
    it("bare: Glimmer Bairn", () => {
        expect(
            compiledDefinition(
                oracleCard({
                    oracleId: "118cdf8b-44fb-4c3e-86c4-e7f4b1267646",
                    name: "Glimmer Bairn",
                    manaCost: "{G}",
                    typeLine: "Creature — Ouphe",
                    oracleText: BAIRN_TEXT,
                    power: "1",
                    toughness: "2",
                })
            )
        ).toEqual(
            sortKeys({
                name: "Glimmer Bairn",
                types: ["Creature"],
                subtypes: ["Ouphe"],
                manaCost: { G: 1 },
                power: 1,
                toughness: 2,
                oracleText: BAIRN_TEXT,
                activatedAbilities: [
                    {
                        id: "glimmer-bairn-ability",
                        oracleText: BAIRN_TEXT,
                        cost: { sacrificeFilter: { isToken: true } },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 2,
                                toughness: 2,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("subtyped: Diamond Kaleidoscope", () => {
        expect(
            compiledDefinition(
                oracleCard({
                    oracleId: "bffa9256-aff4-476f-86f4-4f4c9e57fa69",
                    name: "Diamond Kaleidoscope",
                    manaCost: "{4}",
                    typeLine: "Artifact",
                    oracleText: KALEIDOSCOPE_TEXT,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Diamond Kaleidoscope",
                types: ["Artifact"],
                manaCost: { X: 4 },
                oracleText: KALEIDOSCOPE_TEXT,
                activatedAbilities: [
                    {
                        id: "diamond-kaleidoscope-ability",
                        oracleText:
                            "{3}, {T}: Create a 0/1 colorless Prism artifact creature token.",
                        cost: { mana: { X: 3 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Prism",
                                    types: ["Artifact", "Creature"],
                                    subtypes: ["Prism"],
                                    power: 0,
                                    toughness: 1,
                                    colors: [],
                                },
                                controller: "controller",
                            },
                        ],
                    },
                    {
                        id: "diamond-kaleidoscope-mana-2",
                        oracleText:
                            "Sacrifice a Prism token: Add one mana of any color.",
                        cost: {
                            sacrificeFilter: {
                                subtypes: ["Prism"],
                                isToken: true,
                            },
                        },
                        useStack: false,
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                        ],
                    },
                ],
            })
        );
    });
});

describe("token group without a determiner — golden (CR 111.1)", () => {
    it("Bloodline Culling: every creature token, whoever controls it", () => {
        expect(
            compiledDefinition(
                oracleCard({
                    oracleId: "0b7fabe8-bc44-47b1-93bb-b895a1bd0aa9",
                    name: "Bloodline Culling",
                    manaCost: "{1}{B}{B}",
                    typeLine: "Instant",
                    oracleText: CULLING_TEXT,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Bloodline Culling",
                types: ["Instant"],
                manaCost: { X: 1, B: 2 },
                oracleText: CULLING_TEXT,
                modes: [
                    {
                        id: "bloodline-culling-mode-1",
                        label: "Target creature gets -5/-5 until end of turn",
                        oracleText:
                            "Target creature gets -5/-5 until end of turn.",
                        effects: [
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: -5,
                                toughness: -5,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                    {
                        id: "bloodline-culling-mode-2",
                        label: "Creature tokens get -2/-2 until end of turn",
                        oracleText:
                            "Creature tokens get -2/-2 until end of turn.",
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    filter: { type: "Creature", isToken: true },
                                },
                                effects: [
                                    {
                                        op: "pump",
                                        target: { ref: "$each" },
                                        power: -2,
                                        toughness: -2,
                                        duration: { phase: "end-of-turn" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("token noun in a controls condition (CR 111.1)", () => {
    it.each([
        ["if you control a token", 1],
        ["if you control three or more tokens", 3],
    ])("reads %s as a counted isToken gate", (span, atLeast) => {
        const parsed = conditionRule.run(span, parseContext());
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls",
            filter: { isToken: true },
            atLeast,
        });
    });
});

describe("token noun — refusals", () => {
    const refused: readonly [string, string, string][] = [
        [
            "a bare plural with no token, subtype or controller",
            "Instant",
            "Creatures get -2/-2 until end of turn.",
        ],
        [
            "a token group as a static grant's scope",
            "Artifact",
            "Creature tokens you control have flying.",
        ],
        [
            "nontoken beside token",
            "Artifact",
            "Sacrifice a nontoken token: Draw a card.",
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
