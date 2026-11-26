// The add-a-card-type Verb Frame (CR 205.1b + CR 613.1d, issue #3725): the
// clause the `addCardType` Op is the lowering of.
//
//  1. FORMS — each antecedent and duration the clause is printed with.
//  2. GOLDEN — Liquimetal Coating, a real corpus card, compiles whole to
//     `ready` (no `GOLDEN_FIXTURES` row: it clears no card-dependent form).
//  3. REFUSALS — the neighbours the frame must not read, fail-closed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Test Card",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText,
        })
    );
}

function activatedEffects(oracleText: string) {
    const outcome = compile(oracleText);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    expect(outcome.opsUsed).toContain("addCardType");
    return outcome.definition.activatedAbilities?.[0]?.effects;
}

describe("add a card type (CR 205.1b / CR 613.1d, issue #3725)", () => {
    it("until end of turn on an announced target permanent (CR 611.2a)", () => {
        expect(
            activatedEffects(
                "{T}: Target permanent becomes an artifact in addition to its other types until end of turn."
            )
        ).toEqual([
            {
                op: "addCardType",
                target: { target: 0 },
                cardType: "Artifact",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("no printed duration is indefinite (CR 611.2a) — Memnarch", () => {
        expect(
            activatedEffects(
                "{1}{U}{U}: Target permanent becomes an artifact in addition to its other types."
            )
        ).toEqual([
            { op: "addCardType", target: { target: 0 }, cardType: "Artifact" },
        ]);
    });

    it('"That creature" names the target the sentence before announced (CR 608.2c)', () => {
        expect(
            activatedEffects(
                "{T}, Sacrifice this artifact: Put a +1/+1 counter on target nonartifact creature. That creature becomes an artifact in addition to its other types."
            )
        ).toEqual([
            expect.objectContaining({ op: "counters", target: { target: 0 } }),
            { op: "addCardType", target: { target: 0 }, cardType: "Artifact" },
        ]);
    });

    it("Liquimetal Coating compiles whole to `ready`", () => {
        const outcome = compileCard({
            oracleId: "f4bdc551-c2eb-4a34-a3e3-b4a017c925af",
            name: "Liquimetal Coating",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText:
                "{T}: Target permanent becomes an artifact in addition to its other types until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const ability = outcome.definition.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.effects).toEqual([
            {
                op: "addCardType",
                target: { target: 0 },
                cardType: "Artifact",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("a creature-type add still reads as `addSubtype`, not as this frame", () => {
        const outcome = compile(
            "{2}, {T}: Target creature becomes a Vampire in addition to its other types."
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.opsUsed).toContain("addSubtype");
        expect(outcome.opsUsed).not.toContain("addCardType");
    });

    it.each([
        // CR 205.1b — "becomes a creature" owes P/T: `animate`'s, not this.
        "{T}: Target land becomes a creature in addition to its other types until end of turn.",
        // A digital-only "perpetually" — no duration this engine models.
        "{T}: Target permanent perpetually becomes an artifact in addition to its other types.",
    ])("refuses %s", (text) => {
        const outcome = compile(text);
        const ops = outcome.state === "unparsed" ? [] : outcome.opsUsed;
        expect(ops).not.toContain("addCardType");
    });
});
