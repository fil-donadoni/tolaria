import type { ScenarioSpec } from "@convex/debugScenarioSpec";

/**
 * Who owns a SPEC-LEVEL field when the scenario editor saves (issue #3462).
 *
 * `updateDebugScenario` patches the row's `spec` **wholesale**, so a field the
 * editor does not re-emit is deleted from the stored scenario. Before this
 * classification the form assembled a fresh spec from its own four inputs and
 * the other six fields — `life`, `poison`, `experience`, `companion`,
 * `rngSeed`, `markLastDrawn` — silently vanished on any edit of a curated row
 * (ADR 0044 golden rows are exactly the ones carrying them).
 *
 *  - `form-owned` — the form renders an input for it, so the form's value is
 *    authoritative INCLUDING its absence (clearing `turn` must clear it).
 *  - `preserved` — the form renders nothing for it, so the loaded value is
 *    carried through untouched.
 *
 * The table is `satisfies Record<keyof ScenarioSpec, …>`: a spec field added
 * tomorrow reds `tsc` here until it is classified, which is what makes the
 * spec-widening sequence under PRD #3397 safe.
 *
 * `tsc` is only half of it: classifying a new field does NOT force
 * `normalizeScenarioSpec` (`convex/debugScenarioSpec.ts`) to read it off a raw
 * stored row, and a field normalize drops never reaches this assembler at all.
 * What catches THAT is the render-through-the-form suite in
 * `__tests__/scenario-spec-preservation.test.tsx`, which inflates the row the
 * way the editor does — do not trim it believing the `satisfies` covers it.
 */
export type ScenarioSpecFieldOwner = "form-owned" | "preserved";

export const SCENARIO_SPEC_FIELD_OWNER = {
    cards: "form-owned",
    phase: "form-owned",
    landCount: "form-owned",
    libraryCount: "form-owned",
    turn: "form-owned",
    markLastDrawn: "preserved",
    rngSeed: "preserved",
    poison: "preserved",
    life: "preserved",
    experience: "preserved",
    companion: "preserved",
} as const satisfies Record<keyof ScenarioSpec, ScenarioSpecFieldOwner>;

/** The spec keys the form cannot edit — derived from the table above, never
 *  hand-listed, so it cannot drift from the classification. */
export type PreservedScenarioSpecKey = {
    [K in keyof ScenarioSpec]-?: (typeof SCENARIO_SPEC_FIELD_OWNER)[K] extends "preserved"
        ? K
        : never;
}[keyof ScenarioSpec];

export const PRESERVED_SCENARIO_SPEC_KEYS = (
    Object.keys(SCENARIO_SPEC_FIELD_OWNER) as (keyof ScenarioSpec)[]
).filter(
    (key): key is PreservedScenarioSpecKey =>
        SCENARIO_SPEC_FIELD_OWNER[key] === "preserved"
);

/** Copy one key across two specs keeping the key/value correlation the type
 *  checker needs — a computed-property `Object.assign` would erase it, and the
 *  whole point here is that `tsc` polices the copy. */
function carry<K extends PreservedScenarioSpecKey>(
    target: ScenarioSpec,
    source: ScenarioSpec,
    key: K
): void {
    const value = source[key];
    if (value !== undefined) target[key] = value;
}

/**
 * Assemble the spec to persist: the form's own value for every form-owned
 * field, plus every `preserved` field the loaded row carried. `loaded` is
 * `null` when creating a new scenario — nothing to preserve.
 */
export function assembleScenarioSpec(
    formOwned: ScenarioSpec,
    loaded: ScenarioSpec | null
): ScenarioSpec {
    const spec: ScenarioSpec = { ...formOwned };
    if (!loaded) return spec;
    for (const key of PRESERVED_SCENARIO_SPEC_KEYS) carry(spec, loaded, key);
    return spec;
}
