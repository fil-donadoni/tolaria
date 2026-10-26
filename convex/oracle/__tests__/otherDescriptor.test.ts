// "other" / "other than <self>" in the descriptor reader (CR 201.5, Grammar
// Cluster issue #5286): the set without the SOURCE object. A reference, not a
// type filter, so every converter either encodes it as the catalogue's
// `excludeSource` flag or refuses it — never drops it.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { controlledPluralRule } from "../grammar/shared/massSubject";
import {
    descriptorRule,
    permanentFilterFromDescriptor,
    staticFilterFromDescriptor,
    targetRequirementFromDescriptor,
} from "../grammar/shared/targetFilter";
import { lowerAdditionalCosts } from "../lowerSpell";
import { oracleCard, parseContext } from "./oracle.fixture";

function read(span: string) {
    const outcome = descriptorRule.run(span, parseContext());
    if (!outcome.ok) throw new Error(`${span}: ${outcome.reason}`);
    return outcome.value;
}

describe("other — the reader (CR 201.5)", () => {
    it("reads the adjective in either case, beside the noun", () => {
        for (const span of ["other creatures", "Other creatures"]) {
            const descriptor = read(span);
            expect(descriptor.excludeSource).toBe(true);
            expect(descriptor.types).toEqual(["Creature"]);
            expect(descriptor.plural).toBe(true);
        }
    });

    it("reads 'other than this <noun>' and 'other than {self}' as a qualifier", () => {
        for (const span of [
            "creature other than this creature",
            "permanent other than {self}",
        ])
            expect(read(span).excludeSource).toBe(true);
    });

    it("refuses an exclusion that is not the source, and a doubled one", () => {
        for (const span of [
            "creature other than enchanted creature",
            "other other creatures",
            "other creature other than this creature",
        ])
            expect(descriptorRule.run(span, parseContext()).ok).toBe(false);
    });
});

describe("other — each converter encodes it or refuses it", () => {
    it("a target requirement carries excludeSource", () => {
        const outcome = targetRequirementFromDescriptor(
            read("creature other than this creature")
        );
        expect(outcome.ok && outcome.value).toMatchObject({
            type: "Creature",
            excludeSource: true,
        });
    });

    it("a cost filter refuses it unless the site opts in", () => {
        const descriptor = read("other creatures");
        expect(permanentFilterFromDescriptor(descriptor).ok).toBe(false);
        const opted = permanentFilterFromDescriptor(descriptor, {
            excludeSource: true,
        });
        expect(opted.ok && opted.value.excludeSource).toBe(true);
    });

    it("a static filter refuses it (the frame strips 'Other ' itself)", () => {
        expect(
            staticFilterFromDescriptor(read("other creatures"), "recomputed").ok
        ).toBe(false);
    });

    it("a mass subject without a controller reads 'Other creatures' as the sweep minus the source", () => {
        const outcome = controlledPluralRule.run(
            "Other creatures",
            parseContext()
        );
        expect(outcome.ok && outcome.value.select).toMatchObject({
            set: "permanents",
            filter: { type: "Creature" },
            excludeSource: true,
        });
        // Still refused without the exclusion: the bare plural names no one.
        expect(controlledPluralRule.run("Creatures", parseContext()).ok).toBe(
            false
        );
    });
});

describe("other — whole cards", () => {
    it("a target 'other than this creature' compiles with excludeSource", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Other Target Probe",
                manaCost: "{2}{B}",
                typeLine: "Instant",
                oracleText: "Destroy target creature other than {self}.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(JSON.stringify(outcome)).toContain('"excludeSource":true');
    });

    it("a sacrifice cost 'two other creatures' keeps the exclusion on the cost filter", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Other Cost Probe",
                manaCost: "{3}{B}",
                typeLine: "Creature — Demon",
                oracleText: "Sacrifice two other creatures: Draw a card.",
                power: "3",
                toughness: "3",
            })
        );
        expect(JSON.stringify(outcome)).toContain('"excludeSource":true');
    });
});

describe("other — cast-path costs refuse what only activation costs resolve", () => {
    it("an additional cost sacrificing 'another' permanent has no encoding", () => {
        const outcome = lowerAdditionalCosts([
            {
                kind: "sacrifice-other",
                filter: { types: ["Creature"], excludeSource: true },
                count: 1,
            },
        ]);
        expect(outcome.ok).toBe(false);
    });

    it("the same atom without the exclusion still lowers", () => {
        const outcome = lowerAdditionalCosts([
            {
                kind: "sacrifice-other",
                filter: { types: ["Creature"] },
                count: 1,
            },
        ]);
        expect(outcome.ok).toBe(true);
    });
});
