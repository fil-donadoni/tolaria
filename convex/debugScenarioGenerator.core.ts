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
    normalizeScenarioSpec,
    SCENARIO_PHASES,
    type ScenarioSpec,
} from "./debugScenarioSpec";

export { SCENARIO_PHASES };

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
        life: {
            type: "object",
            additionalProperties: false,
            properties: {
                me: { type: "integer" },
                opp: { type: "integer" },
            },
            description:
                "Starting life totals, if the description names one (default 20 each).",
        },
        // CR 122.1 (issue #1969) — the scaling state a "for each experience
        // counter you have" card reads (Otharri, Suns' Glory).
        experience: {
            type: "object",
            additionalProperties: false,
            properties: {
                me: { type: "integer" },
                opp: { type: "integer" },
            },
            description:
                "Experience counters on a player, if the description names them (default none).",
        },
        // CR 702.139c / ADR 0064 (issue #1392).
        companion: {
            type: "object",
            additionalProperties: false,
            properties: {
                name: {
                    type: "string",
                    description:
                        "Exact card name of the companion, from the allow-list.",
                },
                owner: {
                    type: "string",
                    enum: ["me", "opp"],
                    description: "Whose companion slot it goes in.",
                },
                used: {
                    type: "boolean",
                    description:
                        "true stages the 'already put into hand' state (default false).",
                },
            },
            required: ["name"],
            description:
                "Declare a companion into a slot. Omit unless the description names a companion.",
        },
        markLastDrawn: {
            type: "boolean",
            description:
                "Mark 'me's last hand card as the card drawn this turn, so a 'discard the last card you drew' cost (Jandor's Ring) is payable.",
        },
    },
    required: ["cards"],
};

/**
 * The spec-level keys the schema deliberately does NOT offer the model, each
 * with the reason (issue #3463). `scenarioGeneratorSchemaCoverage.test.ts`
 * sweeps `SCENARIO_SPEC_KEYS` and demands every key be either a
 * `SCENARIO_JSON_SCHEMA.properties` entry or a row here — so the next
 * spec-widening under PRD #3397 has to make the call explicitly instead of
 * leaving the generator quietly a field behind, which is how `experience`,
 * `companion` and `markLastDrawn` sat unreachable since they shipped.
 *
 * `Partial<Record<keyof ScenarioSpec, string>>` and not a bare `string[]`: a
 * row naming a key that no longer exists reds `tsc` rather than silently
 * exempting nothing.
 */
export const SCENARIO_SCHEMA_EXCLUSIONS = {
    // CR 705 / ADR 0023 — the seed decides every coin flip and shuffle the
    // board will produce. A model asked for a board has no basis to pick one,
    // and a hallucinated seed reads as deliberate determinism it is not: the
    // admin sets it in the form (`scenario-spec-ownership.ts` classifies it
    // `form-owned`) when a scenario actually needs a pinned outcome.
    rngSeed: "the model has no basis to invent a PRNG seed — admin-set only",
} as const satisfies Partial<Record<keyof ScenarioSpec, string>>;

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
        "YOUR GOAL: build a FULLY PLAYABLE scenario that lets the user immediately",
        "reproduce the described situation — end to end, with no missing pieces.",
        "A half-built scenario is a FAILURE. If the description implies an action,",
        "the board MUST contain everything needed to actually perform it right now:",
        "the card to play, the mana to pay for it, and the surrounding board it",
        "acts on. Infer and add the obvious prerequisites the user did NOT spell",
        "out — that is the whole point of this tool.",
        "",
        "Concretely, to make a described play performable:",
        "- Put the key spell in 'me' hand (zone: hand) so it can be cast, unless",
        "  the description clearly wants it already resolved on the battlefield.",
        "- Add enough UNTAPPED lands of the RIGHT COLORS to pay its FULL mana cost.",
        "  `landCount` seeds basic lands whose colors automatically match the",
        "  cards you place — so include the spell (or other cards of its colors)",
        "  and raise `landCount` to at least the spell's total mana value. If the",
        "  spell needs a color NOT otherwise present, ALSO place explicit basic",
        "  lands of that color (Plains=W, Island=U, Swamp=B, Mountain=R,",
        "  Forest=G) on 'me' battlefield, untapped.",
        "- Add the board context the effect operates on: e.g. 'Balance with",
        "  creatures and lands' means put creatures and lands in play (for the",
        "  relevant players) AND the mana to cast Balance ({1}{W}, so a Plains",
        "  or two on 'me'), with Balance in 'me' hand.",
        "- Prefer to slightly OVER-provide resources over under-providing; the",
        "  user must never be one land or one card short of the described play.",
        "",
        "Rules:",
        "- Use ONLY card names from the ALLOWED CARDS list below, copied EXACTLY",
        "  (same capitalization and punctuation). Never invent a card name.",
        "- If the description names a card not in the list, pick the closest",
        "  allowed card, or omit it — never emit a name outside the list.",
        "- 'me' is the player whose board is being set up; 'opp' is the opponent.",
        "- Default zone is battlefield; default phase is PRECOMBAT_MAIN.",
        "- Intentionally illegal boards are fine — do not 'fix' the description;",
        "  but 'playable' (the resources to perform the play exist) is REQUIRED.",
        "- If the description names a life total ('me at 4 life', 'opp at 2'),",
        "  set `life.me` / `life.opp` to that exact number; omit `life` entirely",
        "  when no life total is mentioned (default 20 each).",
        "- The same omit-unless-named discipline applies to `experience`,",
        "  `companion` and `markLastDrawn`: emit them ONLY when the description",
        "  actually calls for them, never as decoration.",
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
 * The card-catalogue seam the generator needs, as an injected PORT rather than
 * an import — the whole reason this file (and the `"use node"` action that
 * wraps it) can stay off the card registry's module graph.
 *
 * Both members are ASYNC on purpose. The only production implementation is the
 * action's, and an action has no `ctx.db`: it answers both by `ctx.runQuery`
 * into `convex/debugScenarios.ts`, which runs in the ISOLATE bundle where the
 * registry — and with it `convex/cards/compiledPool.ts`, ~1.9 MB of compiled
 * definitions before source maps — is already resident. A synchronous port
 * would force the action to import the registry itself, and a `"use node"`
 * module's esbuild graph is SEPARATE, so that import inlines the whole pool a
 * SECOND time into the pushed bundle (issue #3444, ADR 0113 § Amendment).
 * `scripts/__tests__/convex-node-bundle-seam.test.ts` pins that it does not.
 */
export type ScenarioCardAuthority = {
    /** Every card name the model may pick from — `getAllCardNames()`, the
     *  implemented (loadable) catalogue. Embedded verbatim in the prompt. */
    allowList: () => Promise<readonly string[]>;
    /** The names in `spec` that do NOT resolve to a placeable card, surfaced
     *  for the human edit step and never written through. */
    unresolved: (spec: ScenarioSpec) => Promise<string[]>;
};

/**
 * Run the full generate → normalize → validate pipeline (stages 1–2 above).
 * Dependency-injected so it is fully unit-testable with a stubbed `generate`
 * and `cards` — no network, no Convex ctx. Does NOT write: it returns the
 * spec plus any unresolved names for the human-in-the-loop preview/edit step.
 */
export async function runScenarioGeneration(deps: {
    description: string;
    generate: ScenarioGenerateFn;
    cards: ScenarioCardAuthority;
}): Promise<GeneratedScenario> {
    const { description, generate, cards } = deps;
    const systemPrompt = buildScenarioSystemPrompt(await cards.allowList());
    const raw = await generate(systemPrompt, description);
    const parsed = parseLlmScenarioText(raw);
    // Tolerant normalize (ADR 0044): drop unknown fields, default missing ones.
    const spec = normalizeScenarioSpec(parsed);
    // Loadability validation, NOT legality (ADR 0044): reject names that don't
    // resolve to a real CardDefinition; also scans attachedTo / copyOf hosts.
    // No token resolver is used on purpose: the generator's prompt offers a
    // CARD allow-list only (CR 111 / 707.2 tokens are not in it), so a `token`
    // entry the model invented is surfaced as unresolved for the human review
    // step rather than written through.
    const unresolved = await cards.unresolved(spec);
    return { spec, unresolved };
}
