// The LLM generator's JSON schema must stay exhaustive over `ScenarioSpec`
// (issue #3463).
//
// `SCENARIO_JSON_SCHEMA` is a hand-written literal handed to Anthropic
// structured output, and `additionalProperties: false` means a field missing
// from it is a field the model CANNOT emit — not a field it emits less often.
// `experience` (issue #1969), `companion` (issue #1392) and `markLastDrawn`
// shipped on the spec and were unreachable from the generator for exactly that
// reason, silently, because nothing compared the two. With thirteen widenings
// queued under PRD #3397 the omission would have become the normal state.
//
// So the sweep below is keyed on `SCENARIO_SPEC_KEYS` — derived from
// `scenarioSpecValidator` itself, never hand-listed — and every key must be
// EITHER a schema property or a row in `SCENARIO_SCHEMA_EXCLUSIONS` carrying
// the reason it is withheld from the model.

import { describe, it, expect } from "vitest";
import {
    SCENARIO_PHASES,
    SCENARIO_SPEC_KEYS,
    type ScenarioSpec,
} from "../debugScenarioSpec";
import {
    SCENARIO_JSON_SCHEMA,
    SCENARIO_SCHEMA_EXCLUSIONS,
} from "../debugScenarioGenerator.core";

const properties = (
    SCENARIO_JSON_SCHEMA as { properties: Record<string, unknown> }
).properties;
const excluded = SCENARIO_SCHEMA_EXCLUSIONS as Partial<
    Record<keyof ScenarioSpec, string>
>;

describe("generator JSON schema coverage over ScenarioSpec (issue #3463)", () => {
    it("sweeps a non-empty, validator-derived key list", () => {
        // Guards against the sweep passing because it swept nothing.
        expect(SCENARIO_SPEC_KEYS).toContain("cards");
        expect(SCENARIO_SPEC_KEYS.length).toBeGreaterThan(10);
    });

    it.each(SCENARIO_SPEC_KEYS)(
        "`%s` is a schema property or a justified exclusion",
        (key) => {
            const inSchema = Object.hasOwn(properties, key);
            const reason = excluded[key];
            expect(inSchema || reason !== undefined).toBe(true);
            // Never both: a key the model can emit needs no exemption, and a
            // stale row would make the next omission look accounted for.
            expect(inSchema && reason !== undefined).toBe(false);
            if (reason !== undefined) expect(reason.length).toBeGreaterThan(20);
        }
    );

    it("invents no property the spec does not have", () => {
        // `normalizeScenarioSpec` drops unknown fields, so a schema key with no
        // spec field is a field the model is told to fill in and that is thrown
        // away on load.
        for (const key of Object.keys(properties)) {
            expect(SCENARIO_SPEC_KEYS).toContain(key);
        }
    });

    it("offers the SHARED phase vocabulary", () => {
        // The admin form's select reads the same list — a generated phase with
        // no option to render against is dropped on the next edit.
        expect((properties.phase as { enum: string[] }).enum).toEqual([
            ...SCENARIO_PHASES,
        ]);
    });

    it("keeps the per-seat fields per-seat", () => {
        for (const key of ["poison", "life", "experience"] as const) {
            const property = properties[key] as {
                properties: Record<string, unknown>;
            };
            expect(Object.keys(property.properties)).toEqual(["me", "opp"]);
        }
    });
});
