import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { SeatPairDraft, SpecDraft } from "./scenario-draft";

/**
 * Who owns a SPEC-LEVEL field when the scenario editor saves (issue #3462),
 * and — since issue #3463 — what the form renders for it.
 *
 * `updateDebugScenario` patches the row's `spec` **wholesale**, so a field the
 * editor does not re-emit is deleted from the stored scenario. Before this
 * classification the form assembled a fresh spec from its own four inputs and
 * the other seven fields — `life`, `poison`, `experience`, `companion`,
 * `rngSeed`, `markLastDrawn` — silently vanished on any edit of a curated row
 * (ADR 0044 golden rows are exactly the ones carrying them).
 *
 *  - `form-owned` — the form renders an input for it, so the form's value is
 *    authoritative INCLUDING its absence (clearing `turn` must clear it).
 *  - `preserved` — the form renders nothing for it, so the loaded value is
 *    carried through untouched.
 *
 * Issue #3463 moved the remaining six to `form-owned`: a knob a human cannot
 * type is a knob only a blade scenario or `specFromState` can produce, and with
 * thirteen widenings queued under PRD #3397 that gap was becoming the normal
 * state. `preserved` stays as the classification a future field can be given —
 * the escape hatch is what makes the table safe, not a category that must be
 * non-empty.
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
    markLastDrawn: "form-owned",
    rngSeed: "form-owned",
    poison: "form-owned",
    life: "form-owned",
    experience: "form-owned",
    companion: "form-owned",
} as const satisfies Record<keyof ScenarioSpec, ScenarioSpecFieldOwner>;

/** The spec keys the form cannot edit — derived from the table above, never
 *  hand-listed, so it cannot drift from the classification. Empty since issue
 *  #3463; the machinery below stays because the NEXT widening may well be
 *  classified `preserved`, and finding that out after an edit ate a golden
 *  row is the failure this exists to prevent. */
export type PreservedScenarioSpecKey = {
    [K in keyof ScenarioSpec]-?: (typeof SCENARIO_SPEC_FIELD_OWNER)[K] extends "preserved"
        ? K
        : never;
}[keyof ScenarioSpec];

/**
 * Widened read of the classification. The table is `as const` — that is what
 * lets `PreservedScenarioSpecKey` / `FormOwnedScenarioSpecKey` be derived at
 * the TYPE level — but it also means a direct `=== "preserved"` comparison reds
 * `tsc` ("no overlap") while no field carries that classification. Reading
 * through the union keeps the runtime checks honest without baking today's
 * classification into the comparison itself.
 */
export function scenarioSpecFieldOwner(
    key: keyof ScenarioSpec
): ScenarioSpecFieldOwner {
    return SCENARIO_SPEC_FIELD_OWNER[key];
}

export const PRESERVED_SCENARIO_SPEC_KEYS = (
    Object.keys(SCENARIO_SPEC_FIELD_OWNER) as (keyof ScenarioSpec)[]
).filter(
    (key): key is PreservedScenarioSpecKey =>
        scenarioSpecFieldOwner(key) === "preserved"
);

/** Mirror of the above: the keys the form MUST render an input for. */
export type FormOwnedScenarioSpecKey = {
    [K in keyof ScenarioSpec]-?: (typeof SCENARIO_SPEC_FIELD_OWNER)[K] extends "form-owned"
        ? K
        : never;
}[keyof ScenarioSpec];

export const FORM_OWNED_SCENARIO_SPEC_KEYS = (
    Object.keys(SCENARIO_SPEC_FIELD_OWNER) as (keyof ScenarioSpec)[]
).filter(
    (key): key is FormOwnedScenarioSpecKey =>
        scenarioSpecFieldOwner(key) === "form-owned"
);

/**
 * HOW each form-owned field is rendered. `form-owned` means "there is an input
 * for it", and this table is what makes that claim checkable rather than
 * remembered: the spec-field component renders from it, and
 * `__tests__/scenario-spec-fields.test.tsx` asserts every aria-label it derives
 * is in the document. Classify a new field `form-owned` and `tsc` demands a row
 * here; add the row and the test demands the input.
 *
 *  - `per-seat` renders the me/opp pair the spec's own shape already has
 *    (`poison` / `life` / `experience` are all `{ me?, opp? }`).
 *  - `cards` is the card repeater (`DebugScenarioCardFields`), which carries
 *    its own per-row labels — no spec-level input of its own.
 */
export type ScenarioSpecFieldInput =
    | { kind: "cards" }
    | { kind: "number"; label: string; min?: number }
    | { kind: "phase"; label: string }
    | { kind: "boolean"; label: string }
    | { kind: "per-seat"; label: string; min?: number }
    | { kind: "companion"; label: string };

export const SCENARIO_SPEC_FIELD_INPUT = {
    cards: { kind: "cards" },
    phase: { kind: "phase", label: "phase" },
    landCount: { kind: "number", label: "lands", min: 0 },
    libraryCount: { kind: "number", label: "library", min: 0 },
    turn: { kind: "number", label: "turn", min: 1 },
    markLastDrawn: { kind: "boolean", label: "mark last drawn" },
    rngSeed: { kind: "number", label: "rng seed" },
    poison: { kind: "per-seat", label: "poison", min: 0 },
    life: { kind: "per-seat", label: "life" },
    experience: { kind: "per-seat", label: "experience", min: 0 },
    companion: { kind: "companion", label: "companion" },
} as const satisfies {
    [K in FormOwnedScenarioSpecKey]: ScenarioSpecFieldInputFor<K>;
};

/**
 * The kind a field's row MAY declare, derived from the type of its `SpecDraft`
 * field. Without this the table and the draft are two hand-kept mirrors, and a
 * row that kinds `life` as a plain `number` would typecheck while the component
 * rendered a single input against a `{ me, opp }` object — the rendering loop
 * narrows on `kind` and reads the draft field on the strength of it.
 */
type ScenarioSpecFieldInputFor<K extends FormOwnedScenarioSpecKey> =
    K extends keyof SpecDraft
        ? ScenarioSpecFieldInputForValue<SpecDraft[K]>
        : { kind: "cards" };

type ScenarioSpecFieldInputForValue<V> = V extends SeatPairDraft
    ? { kind: "per-seat"; label: string; min?: number }
    : V extends boolean
      ? { kind: "boolean"; label: string }
      : V extends string
        ?
              | { kind: "number"; label: string; min?: number }
              | { kind: "phase"; label: string }
        : { kind: "companion"; label: string };

/** The two seats every per-seat spec field is shaped by. */
export const SCENARIO_SEATS = ["me", "opp"] as const;
export type ScenarioSeat = (typeof SCENARIO_SEATS)[number];

/**
 * The aria-labels a form-owned field renders, derived from its input shape —
 * the SINGLE authority, read by the component that renders the inputs and by
 * the test that proves they are rendered. A hand-written list on either side
 * would just be the same omission made twice.
 */
export function scenarioSpecFieldLabels(
    key: FormOwnedScenarioSpecKey
): string[] {
    const input: ScenarioSpecFieldInput = SCENARIO_SPEC_FIELD_INPUT[key];
    switch (input.kind) {
        case "cards":
            return [];
        case "per-seat":
            return SCENARIO_SEATS.map((seat) => `${input.label} ${seat}`);
        case "companion":
            return [
                `${input.label} name`,
                `${input.label} owner`,
                `${input.label} used`,
            ];
        default:
            return [input.label];
    }
}

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
