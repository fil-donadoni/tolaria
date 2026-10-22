// "Each player chooses … of each <category>": the per-category pick
// (`chooseCategorized`) over the five basic land types and the five colours
// (CR 101.4, CR 701.21a, CR 701.9a; Grammar Cluster of issue #5501).
//
// Two layers:
//
//  1. GOLDEN — a real corpus card compiled whole must produce exactly its
//     fixture's Compiled Definition, one per accepted form: keep a land of
//     each basic land type and sacrifice the rest (Global Ruin), the two-
//     sentence bounce (Planar Overlay), keep a card of each colour from a
//     revealed hand (Noxious Vapors).
//  2. REFUSALS — the neighbours the rules must NOT read (fail-closed,
//     ADR 0105 § 2): a half of the two-sentence bounce without the other,
//     and an axis the corpus does not print.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const FORMS = ["Global Ruin", "Planar Overlay", "Noxious Vapors"];

describe("golden: one accepted form per card", () => {
    for (const name of FORMS) {
        it(`${name} compiles to its fixture`, () => {
            const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name)!;
            const outcome = compileCard(fixture.card as OracleCard);
            if (outcome.state === "unparsed")
                throw new Error(JSON.stringify(outcome.gaps));
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(fixture.expected)
            );
        });
    }
});

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("refusals: neighbours the rules do not read", () => {
    const refused: [string, string][] = [
        [
            "a pick per basic land type with no sentence returning it",
            "Each player chooses a land they control of each basic land type.",
        ],
        [
            "a return of 'those lands' with no pick before it",
            "Return those lands to their owners' hands.",
        ],
        [
            "a pick per land type that is not the basic ones",
            "Each player chooses from the lands they control a land of each land type, then sacrifices the rest.",
        ],
        [
            "a hand pick per colour that sweeps lands too",
            "Each player reveals their hand, chooses one card of each color from it, then discards all other cards.",
        ],
    ];
    for (const [label, text] of refused)
        it(`refuses ${label}`, () => {
            expect(compileCard(sorcery("Probe", "{2}{U}", text)).state).toBe(
                "unparsed"
            );
        });
});
