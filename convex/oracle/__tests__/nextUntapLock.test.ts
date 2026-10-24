// "<it> doesn't untap during your next untap step" — the one-shot untap lock
// on the source (CR 502.3), behind an attack trigger's "if defending player
// controls no <things>" (CR 603.4).
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (Spectral Bears, Spectral Force).
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
