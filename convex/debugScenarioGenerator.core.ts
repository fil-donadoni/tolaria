// LLM debug-scenario generator — PURE CORE (issue #771, ADR 0044). The
// natural-language → `debugScenarios` spec pipeline, split into a pure,
// network-free core (unit-tested directly by mocking the LLM call — the
// project's no-convex-test-harness convention, prior art `banlistSync.ts`) and
// a thin `"use node"` action wrapper (`convex/debugScenarioGenerator.ts`) that
// injects the real Anthropic call.
//
// The pipeline is three stages, and generation NEVER happens inside a mutation:
//   1. `runScenarioGeneration` asks the model (injected `generate`) for a spec
//      in the `debugScenarios` shape, constrained to a card allow-list.
//   2. Resolve / validate — LOADABILITY, not legality (ADR 0044). Each card
//      name is checked against the implemented registry (`tryGetCardByName`,
//      injected as `resolves`). Unknown names are surfaced for edit, never
//      silently inserted; SBA / legality are intentionally NOT run (illegal
//      debug states are the whole point).
//   3. The WRITE goes through the existing `assertIsAdmin`-gated
//      `saveDebugScenario` mutation (issue #769) — after the human confirms in
//      the preview/edit UI. This core does no writes.
//
// Allow-list note: the model is constrained to `getAllCardNames()` — the
// implemented catalogue. That set is a verified SUBSET of the broader
// `data/card-index.json` catalogue (every registered card is catalogued), so
// "in card-index.json AND resolves in the registry" (the AC's intersection)
// reduces to "resolves in the registry". Constraining the model to the loadable
// subset up front minimizes rejected names while staying within the card-index
// allow-list.

import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "./debugScenarioSpec";

/** The phases a scenario may start in — mirrors `Phase` (`convex/gre/types.ts`,
 *  minus the transient `MULLIGAN` / `UNTAP` / `CLEANUP` steps a debug board
 *  never wants to open in). Surfaced to the model in the prompt. */
export const SCENARIO_PHASES = [
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
] as const;

/**
 * JSON Schema handed to Anthropic structured output (`output_config.format`).
 * A faithful subset of `scenarioSpecValidator` (`convex/debugScenarioSpec.ts`):
 * every object is `additionalProperties: false` so the model can't invent keys.
 * `counters` (a dynamic-key record) is intentionally OMITTED — structured
 * output doesn't support `additionalProperties: <type>`, and counters are rarely
 * needed to describe a board; a user can add them in the preview/edit step. The
 * tolerant load path (`normalizeScenarioSpec`) still accepts them if present.
 */
export const SCENARIO_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        cards: {
            type: "array",
            description: "The card placements that make up the board.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: {
                        type: "string",
                        description:
                            "Exact card name, copied verbatim from the allow-list.",
                    },
                    owner: {
                        type: "string",
                        enum: ["me", "opp"],
                        description:
                            "'me' is the viewer, 'opp' is the opponent.",
                    },
                    zone: {
                        type: "string",
                        enum: [
                            "hand",
                            "battlefield",
                            "library",
                            "graveyard",
                            "exile",
                        ],
                        description: "Defaults to battlefield when omitted.",
                    },
                    tapped: { type: "boolean" },
                    count: {
                        type: "integer",
                        description: "How many copies to place (default 1).",
                    },
                    position: { type: "integer" },
                    attachedTo: {
                        type: "string",
                        description:
                            "For Auras/Equipment: the name of the host permanent.",
                    },
                    copyOf: {
                        type: "string",
                        description: "Name of the card this is a copy of.",
                    },
                    damageMarked: { type: "integer" },
                    summoningSick: { type: "boolean" },
                    attackedLastTurn: { type: "boolean" },
                    faceDown: { type: "boolean" },
                },
                required: ["name", "owner"],
            },
        },
        phase: {
            type: "string",
            enum: [...SCENARIO_PHASES],
            description:
                "The phase the board opens in (default PRECOMBAT_MAIN).",
        },
        landCount: {
            type: "integer",
            description:
                "Untapped basic lands to add to 'me' for paying costs (default 0).",
        },
        libraryCount: { type: "integer" },
        turn: { type: "integer" },
        poison: {
            type: "object",
            additionalProperties: false,
            properties: {
                me: { type: "integer" },
                opp: { type: "integer" },
            },
        },
    },
    required: ["cards"],
};

/** Signature of the injected LLM call: given a system prompt and the user's
 *  board description, return the raw model text (expected to be the JSON spec).
 *  The action wraps the real Anthropic call; tests pass a stub. */
export type ScenarioGenerateFn = (
    systemPrompt: string,
    userDescription: string
) => Promise<string>;

/**
 * Build the system prompt that constrains the model to the card allow-list and
 * the `debugScenarios` shape. The allow-list is embedded verbatim so the model
 * only ever picks catalogued, loadable cards.
 */
export function buildScenarioSystemPrompt(
    allowList: readonly string[]
): string {
    return [
        "You set up Magic: The Gathering debug board states for a rules engine.",
        "Given a natural-language description of a board, produce a scenario spec",
        "as JSON matching the provided schema.",
        "",
        "Rules:",
        "- Use ONLY card names from the ALLOWED CARDS list below, copied EXACTLY",
        "  (same capitalization and punctuation). Never invent a card name.",
        "- If the description names a card not in the list, pick the closest",
        "  allowed card, or omit it — never emit a name outside the list.",
        "- 'me' is the player whose board is being set up; 'opp' is the opponent.",
        "- Default zone is battlefield; default phase is PRECOMBAT_MAIN.",
        "- Set landCount high enough that 'me' can pay for any spell the",
        "  description implies casting.",
        "- Intentionally illegal boards are fine — do not 'fix' the description.",
        "",
        `ALLOWED CARDS (${allowList.length}):`,
        allowList.join(", "),
    ].join("\n");
}

/**
 * Parse the raw model output into an untyped object. Tolerates a JSON payload
 * wrapped in markdown code fences (```json … ```), which some models emit even
 * under structured output. Throws a clear error the UI can surface if the text
 * isn't JSON at all.
 */
export function parseLlmScenarioText(raw: string): unknown {
    const trimmed = raw.trim();
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    try {
        return JSON.parse(unfenced);
    } catch {
        throw new Error("Model did not return valid JSON");
    }
}

/**
 * Build the effective description for a REGENERATE / VARY run (issue #772, ADR
 * 0044). Regenerate re-runs a row's stored prompt verbatim to produce a NEW
 * scenario (the saved row never drifts — re-running yields a distinct row).
 * "Vary" appends a tweak so the model re-prompts with an adjustment. Pure and
 * trimmed so the same combined text is what gets stored on the new row,
 * documenting the varied intent for a further re-vary.
 */
export function buildRegenerateDescription(
    prompt: string,
    tweak?: string
): string {
    const base = prompt.trim();
    const extra = tweak?.trim();
    return extra ? `${base}\n\nAdjustment: ${extra}` : base;
}

/** The generator's result: the tolerantly-normalized spec ready for the
 *  preview/edit step, plus the card names that don't resolve (surfaced as
 *  validation errors, never written). */
export interface GeneratedScenario {
    spec: ScenarioSpec;
    unresolved: string[];
}

/**
 * Run the full generate → normalize → validate pipeline (stages 1–2 above).
 * Dependency-injected so it is fully unit-testable with a stubbed `generate`
 * and `resolves` — no network, no Convex ctx. Does NOT write: it returns the
 * spec plus any unresolved names for the human-in-the-loop preview/edit step.
 */
export async function runScenarioGeneration(deps: {
    description: string;
    allowList: readonly string[];
    generate: ScenarioGenerateFn;
    resolves: (name: string) => boolean;
}): Promise<GeneratedScenario> {
    const { description, allowList, generate, resolves } = deps;
    const systemPrompt = buildScenarioSystemPrompt(allowList);
    const raw = await generate(systemPrompt, description);
    const parsed = parseLlmScenarioText(raw);
    // Tolerant normalize (ADR 0044): drop unknown fields, default missing ones.
    const spec = normalizeScenarioSpec(parsed);
    // Loadability validation, NOT legality (ADR 0044): reject names that don't
    // resolve to a real CardDefinition; also scans attachedTo / copyOf hosts.
    const unresolved = collectUnresolvedCardNames(spec, resolves);
    return { spec, unresolved };
}
