// "Choose a land type and a basic land type. Each land of the first chosen
// type becomes the second chosen type until end of turn." (CR 205.3i / 305.6 /
// 305.7, issue #5173).
//
//  1. GOLDEN — the one corpus card (Vision Charm) compiles whole, the whole
//     Compiled Definition compared against its `GOLDEN_FIXTURES` row (which
//     carries the form to the smoke generator).
//  2. REFUSALS — the neighbours the rule must not read, fail-closed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

const CHOOSE = "Choose a land type and a basic land type.";
const WRITE_BACK =
    "Each land of the first chosen type becomes the second chosen type until end of turn.";

function compileSorcery(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Test Card",
            manaCost: "{U}",
            typeLine: "Sorcery",
            oracleText,
        })
    );
}

describe("chosen land types (CR 205.3i / 305.6 / 305.7, issue #5173)", () => {
    it("GOLDEN — Vision Charm compiles to its fixture, whole", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Vision Charm"
        )!;
        const outcome = compileCard(oracleCard(fixture.card));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
    });

    it("the bare two-sentence line compiles to two picks and the forEach write-back", () => {
        const outcome = compileSorcery(`${CHOOSE} ${WRITE_BACK}`);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.effects?.map((op) => op.op)).toEqual([
            "chooseLandType",
            "chooseLandType",
            "forEach",
        ]);
    });

    it.each([
        // CR 205.3i — two unrestricted picks: the second pick's basic-only
        // restriction is part of the form, not a default.
        ["Choose two land types.", WRITE_BACK],
        // A narrower subject is a different set (only "Each land" is read).
        [
            CHOOSE,
            "Each land you control of the first chosen type becomes the second chosen type until end of turn.",
        ],
        // CR 305.7 — gaining a type "in addition to" its own is not a set.
        [
            CHOOSE,
            "Each land of the first chosen type is the second chosen type in addition to its other types until end of turn.",
        ],
    ])("REFUSES %s %s", (head, tail) => {
        expect(compileSorcery(`${head} ${tail}`).state).toBe("unparsed");
    });

    it("QUARANTINES the write-back without the choose sentence (its refs are unbound)", () => {
        const outcome = compileSorcery(WRITE_BACK);
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toEqual([
            "validate-effect-script",
        ]);
    });
});
