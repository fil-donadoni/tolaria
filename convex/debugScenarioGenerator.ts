"use node";

// LLM debug-scenario generator — ACTION wrapper (issue #771, ADR 0044). A
// `"use node"` Convex action is the ONLY place external network access is
// allowed, and generation MUST NOT happen inside a mutation — hence a dedicated
// action file separate from the `debugScenarios.ts` mutations. This wrapper does
// nothing but plumb the real Anthropic call + the registry allow-list/resolver
// into the pure `runScenarioGeneration` core (`debugScenarioGenerator.core.ts`).
//
// It returns the (previewable) spec plus any unresolved card names — it does NOT
// write. The write goes through the existing `assertIsAdmin`-gated
// `saveDebugScenario` mutation after the human confirms in the preview/edit UI.

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAllCardNames, tryGetCardByName } from "./cards";
import {
    SCENARIO_JSON_SCHEMA,
    runScenarioGeneration,
    type ScenarioGenerateFn,
} from "./debugScenarioGenerator.core";

// Anthropic model id — the latest recommended Claude model (claude-api skill).
const SCENARIO_MODEL = "claude-opus-4-8";

/**
 * The real LLM call, built around the Anthropic SDK. The API key lives in the
 * Convex deployment env (`ANTHROPIC_API_KEY`, set out-of-band) and NEVER reaches
 * the client — this runs server-side in the action. Uses structured output
 * (`output_config.format`) so the model returns the spec as schema-constrained
 * JSON. Returns the raw text; the core parses + validates it.
 */
function makeAnthropicGenerate(apiKey: string): ScenarioGenerateFn {
    const client = new Anthropic({ apiKey });
    return async (systemPrompt, userDescription) => {
        const response = await client.messages.create({
            model: SCENARIO_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            output_config: {
                format: {
                    type: "json_schema",
                    schema: SCENARIO_JSON_SCHEMA,
                },
            },
            messages: [{ role: "user", content: userDescription }],
        });
        const text = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        if (!text) {
            throw new Error("Model returned no text content");
        }
        return text;
    };
}

/**
 * Generate a debug-scenario spec from a natural-language board description
 * (issue #771). Admin-gated (mirrors `saveDebugScenario`): an action has no
 * `ctx.db`, so the gate runs via `requireAdminQuery`. Constrains the model to
 * the implemented card catalogue (`getAllCardNames()` — the loadable subset of
 * `data/card-index.json`) and validates every name against the registry
 * (`tryGetCardByName`). Returns the normalized spec plus any unresolved names —
 * NOTHING is written here; the preview/edit UI confirms before calling
 * `saveDebugScenario`.
 */
export const generateDebugScenario = action({
    args: { description: v.string() },
    returns: v.object({
        spec: v.any(),
        unresolved: v.array(v.string()),
    }),
    handler: async (ctx, { description }) => {
        await ctx.runQuery(internal.auth.requireAdminQuery, {});

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error(
                "ANTHROPIC_API_KEY is not set in the Convex deployment env"
            );
        }
        const trimmed = description.trim();
        if (!trimmed) {
            throw new Error("Description is empty");
        }

        return await runScenarioGeneration({
            description: trimmed,
            allowList: getAllCardNames(),
            generate: makeAnthropicGenerate(apiKey),
            resolves: (name) => tryGetCardByName(name) !== null,
        });
    },
});
