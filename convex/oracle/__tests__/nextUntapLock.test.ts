// "<it> doesn't untap during your next untap step" — the one-shot untap lock
// on the source (CR 502.3), behind an attack trigger's "if defending player
// controls no <things>" (CR 603.4).
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (Spectral Bears, Spectral Force).
//     "<target permanent> doesn't untap during its controller's next untap
//     step" — the same lock on one announced permanent (Fogwalker, Skyline
//     Cascade).
//  2. REFUSALS — the neighbours of the clause stay unparsed: a subject other
//     than the source, a different step owner, a pronoun after a condition
//     that names an object.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

const SPECTRAL_BEARS = oracleCard({
    oracleId: "539899f3-f3f2-4f7a-a6f6-e80d4a39f753",
    name: "Spectral Bears",
    manaCost: "{2}{G}",
    typeLine: "Creature — Bear Spirit",
    power: "3",
    toughness: "3",
    oracleText:
        "Whenever this creature attacks, if defending player controls no black nontoken permanents, it doesn't untap during your next untap step.",
});

const SPECTRAL_FORCE = oracleCard({
    oracleId: "271bfde0-6a6f-4bc8-ac0e-d2eff6784463",
    name: "Spectral Force",
    manaCost: "{3}{G}{G}",
    typeLine: "Creature — Elemental",
    power: "6",
    toughness: "6",
    oracleText:
        "Whenever this creature attacks, if defending player controls no black permanents, it doesn't untap during your next untap step.",
});

function expected(
    name: string,
    cost: Record<string, number>,
    subtypes: string[],
    pt: number,
    text: string,
    filter: Record<string, unknown>
) {
    return {
        name,
        types: ["Creature"],
        subtypes,
        manaCost: cost,
        power: pt,
        toughness: pt,
        oracleText: text,
        compiledTriggeredAbilities: [
            {
                id: `${name.toLowerCase().replace(" ", "-")}-trigger`,
                oracleText: text,
                head: { kind: "attacks" },
                condition: {
                    kind: "controls",
                    player: "opponent",
                    filter,
                    atMost: 0,
                },
                effects: [{ op: "skipNextUntap", target: { ref: "$source" } }],
            },
        ],
    };
}

describe("compiled whole (CR 502.3, CR 603.4)", () => {
    it("Spectral Bears — nontoken black permanents", () => {
        const result = compileCard(SPECTRAL_BEARS);
        expect(result.state).toBe("ready");
        if (result.state !== "ready") return;
        expect(sortKeys(result.definition)).toEqual(
            sortKeys(
                expected(
                    "Spectral Bears",
                    { X: 2, G: 1 },
                    ["Bear", "Spirit"],
                    3,
                    SPECTRAL_BEARS.oracleText,
                    { types: PERMANENT_TYPES, colors: ["B"], isToken: false }
                )
            )
        );
    });

    it("Spectral Force — black permanents", () => {
        const result = compileCard(SPECTRAL_FORCE);
        expect(result.state).toBe("ready");
        if (result.state !== "ready") return;
        expect(sortKeys(result.definition)).toEqual(
            sortKeys(
                expected(
                    "Spectral Force",
                    { X: 3, G: 2 },
                    ["Elemental"],
                    6,
                    SPECTRAL_FORCE.oracleText,
                    { types: PERMANENT_TYPES, colors: ["B"] }
                )
            )
        );
    });
});

describe("refusals stay unparsed (fail-closed)", () => {
    const body = (text: string) =>
        compileCard(oracleCard({ oracleText: text })).state;

    it("a pronoun after a condition that names an object", () => {
        expect(
            body(
                "Whenever this creature attacks, if you control a Bear, it doesn't untap during your next untap step."
            )
        ).toBe("unparsed");
    });

    it("a subject other than the source", () => {
        expect(
            body(
                "Whenever this creature attacks, target creature doesn't untap during your next untap step."
            )
        ).toBe("unparsed");
    });

    it("a different step owner", () => {
        expect(
            body(
                "Whenever this creature attacks, if defending player controls no black permanents, it doesn't untap during its controller's next untap step."
            )
        ).toBe("unparsed");
    });
});

const FOGWALKER = oracleCard({
    oracleId: "c597cfae-3f92-4d31-8bc1-5a2da995f1bf",
    name: "Fogwalker",
    manaCost: "{1}{U}",
    typeLine: "Creature — Spirit",
    power: "1",
    toughness: "3",
    oracleText:
        "Skulk (This creature can't be blocked by creatures with greater power.)\nWhen this creature enters, target creature an opponent controls doesn't untap during its controller's next untap step.",
});

const SKYLINE_CASCADE = oracleCard({
    oracleId: "79301ae1-8c9c-4723-be21-dc27e1646f35",
    name: "Skyline Cascade",
    manaCost: "",
    typeLine: "Land",
    power: undefined,
    toughness: undefined,
    oracleText:
        "This land enters tapped.\nWhen this land enters, target creature an opponent controls doesn't untap during its controller's next untap step.\n{T}: Add {U}.",
});

const LOCK_TEXT =
    "When this creature enters, target creature an opponent controls doesn't untap during its controller's next untap step.";
const LAND_LOCK_TEXT =
    "When this land enters, target creature an opponent controls doesn't untap during its controller's next untap step.";

describe("one announced permanent, its controller's next untap step (CR 502.3)", () => {
    it("Fogwalker — enters trigger on a creature", () => {
        const result = compileCard(FOGWALKER);
        expect(result.state).toBe("ready");
        if (result.state !== "ready") return;
        expect(sortKeys(result.definition)).toEqual(
            sortKeys({
                name: "Fogwalker",
                types: ["Creature"],
                subtypes: ["Spirit"],
                manaCost: { X: 1, U: 1 },
                power: 1,
                toughness: 3,
                oracleText: FOGWALKER.oracleText,
                staticAbilities: ["skulk"],
                compiledTriggeredAbilities: [
                    {
                        id: "fogwalker-trigger",
                        oracleText: LOCK_TEXT,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            { op: "skipNextUntap", target: { target: 0 } },
                        ],
                    },
                ],
            })
        );
    });

    it("Skyline Cascade — enters trigger on a land", () => {
        const result = compileCard(SKYLINE_CASCADE);
        expect(result.state).toBe("ready");
        if (result.state !== "ready") return;
        expect(sortKeys(result.definition)).toEqual(
            sortKeys({
                name: "Skyline Cascade",
                types: ["Land"],
                oracleText: SKYLINE_CASCADE.oracleText,
                entersTapped: true,
                activatedAbilities: [
                    {
                        id: "skyline-cascade-mana",
                        oracleText: "{T}: Add {U}.",
                        cost: { tap: true },
                        manaProduced: { U: 1 },
                        useStack: false,
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "skyline-cascade-trigger",
                        oracleText: LAND_LOCK_TEXT,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            { op: "skipNextUntap", target: { target: 0 } },
                        ],
                    },
                ],
            })
        );
    });
});

describe("its controller's next untap step — refusals (fail-closed)", () => {
    const body = (text: string) =>
        compileCard(oracleCard({ oracleText: text })).state;

    it("the source with its controller's step", () => {
        expect(
            body(
                "When this creature enters, this creature doesn't untap during its controller's next untap step."
            )
        ).toBe("unparsed");
    });

    it("a player target", () => {
        expect(
            body(
                "When this creature enters, target player doesn't untap during its controller's next untap step."
            )
        ).toBe("unparsed");
    });

    it("another target creature", () => {
        expect(
            body(
                "When this creature enters, another target creature doesn't untap during its controller's next untap step."
            )
        ).toBe("unparsed");
    });

    it("more than one announced permanent", () => {
        expect(
            body(
                "When this creature enters, two target creatures don't untap during their controllers' next untap steps."
            )
        ).toBe("unparsed");
        expect(
            body(
                "When this creature enters, up to two target creatures doesn't untap during its controller's next untap step."
            )
        ).toBe("unparsed");
    });
});
