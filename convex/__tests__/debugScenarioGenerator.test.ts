// LLM debug-scenario generator — pure core (issue #771, ADR 0044). The project
// has no convex-test harness (see `banlists.test.ts` / `decks.test.ts`), so the
// action is a thin wrapper and these tests exercise the pure
// `runScenarioGeneration` core directly with a MOCKED LLM response — the real
// Anthropic API is NEVER called. Covers both the validation ACCEPT case (every
// name resolves) and the REJECT case (unresolved names surfaced, not written),
// plus the prompt constraint and JSON-fence tolerance.

import { describe, it, expect, vi } from "vitest";
import {
    buildRegenerateDescription,
    buildScenarioSystemPrompt,
    parseLlmScenarioText,
    runScenarioGeneration,
    SCENARIO_JSON_SCHEMA,
    type ScenarioGenerateFn,
} from "../debugScenarioGenerator.core";

// A tiny catalogue standing in for the real registry allow-list/resolver.
const ALLOW_LIST = ["Forest", "Craw Wurm", "Wild Growth", "Shatter"] as const;
const resolves = (name: string): boolean =>
    (ALLOW_LIST as readonly string[]).includes(name);

/** Build a `generate` stub that returns a fixed JSON string, and record the
 *  system prompt it was called with so the allow-list constraint is assertable. */
function stubGenerate(json: string): {
    generate: ScenarioGenerateFn;
    calls: { system: string; user: string }[];
} {
    const calls: { system: string; user: string }[] = [];
    const generate: ScenarioGenerateFn = async (system, user) => {
        calls.push({ system, user });
        return json;
    };
    return { generate, calls };
}

describe("buildScenarioSystemPrompt (issue #771)", () => {
    it("embeds every allowed card name so the model is constrained to the catalogue", () => {
        const prompt = buildScenarioSystemPrompt(ALLOW_LIST);
        for (const name of ALLOW_LIST) {
            expect(prompt).toContain(name);
        }
        expect(prompt).toContain(`ALLOWED CARDS (${ALLOW_LIST.length})`);
    });
});

describe("parseLlmScenarioText (issue #771)", () => {
    it("parses bare JSON", () => {
        expect(parseLlmScenarioText('{"cards":[]}')).toEqual({ cards: [] });
    });

    it("tolerates markdown-fenced JSON", () => {
        expect(
            parseLlmScenarioText('```json\n{"cards":[]}\n```')
        ).toEqual({ cards: [] });
    });

    it("throws a clear error on non-JSON output", () => {
        expect(() => parseLlmScenarioText("sorry, I cannot")).toThrow(
            /valid JSON/
        );
    });
});

describe("SCENARIO_JSON_SCHEMA (issue #771)", () => {
    it("locks objects with additionalProperties:false and requires cards", () => {
        expect(SCENARIO_JSON_SCHEMA.additionalProperties).toBe(false);
        expect(SCENARIO_JSON_SCHEMA.required).toContain("cards");
        const cardItem = SCENARIO_JSON_SCHEMA.properties.cards.items;
        expect(cardItem.additionalProperties).toBe(false);
        expect(cardItem.required).toEqual(["name", "owner"]);
    });
});

describe("buildRegenerateDescription — regenerate / vary (issue #772)", () => {
    it("returns the stored prompt verbatim (trimmed) for a plain regenerate", () => {
        expect(buildRegenerateDescription("  Forest with Wild Growth  ")).toBe(
            "Forest with Wild Growth"
        );
    });

    it("appends a tweak as an adjustment for a vary", () => {
        expect(
            buildRegenerateDescription("Forest with Wild Growth", "add a Craw Wurm")
        ).toBe("Forest with Wild Growth\n\nAdjustment: add a Craw Wurm");
    });

    it("ignores a blank/whitespace tweak (behaves like a plain regenerate)", () => {
        expect(buildRegenerateDescription("Forest", "   ")).toBe("Forest");
        expect(buildRegenerateDescription("Forest", undefined)).toBe("Forest");
    });

    it("regenerating twice from the same prompt yields the SAME description (a new row comes from re-running, not from prompt drift)", () => {
        const prompt = "Mishra's Factory with lands to animate it";
        expect(buildRegenerateDescription(prompt)).toBe(
            buildRegenerateDescription(prompt)
        );
    });
});

describe("runScenarioGeneration — validate accept case (issue #771)", () => {
    it("normalizes a well-formed spec and reports NO unresolved names", async () => {
        const { generate, calls } = stubGenerate(
            JSON.stringify({
                cards: [
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    {
                        name: "Wild Growth",
                        owner: "me",
                        zone: "battlefield",
                        attachedTo: "Forest",
                    },
                    { name: "Craw Wurm", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                landCount: 4,
            })
        );

        const result = await runScenarioGeneration({
            description: "Forest enchanted with Wild Growth, Craw Wurm in hand",
            allowList: ALLOW_LIST,
            generate,
            resolves,
        });

        expect(result.unresolved).toEqual([]);
        expect(result.spec.cards).toHaveLength(3);
        expect(result.spec.landCount).toBe(4);
        expect(result.spec.phase).toBe("PRECOMBAT_MAIN");
        // The model saw the allow-list constraint.
        expect(calls[0].system).toContain("Forest");
    });
});

describe("runScenarioGeneration — validate reject case (issue #771)", () => {
    it("surfaces an unknown card name (loadability), leaving the spec for edit", async () => {
        const { generate } = stubGenerate(
            JSON.stringify({
                cards: [
                    { name: "Forest", owner: "me" },
                    { name: "Black Lotus", owner: "me", zone: "hand" }, // not in allow-list
                ],
            })
        );

        const result = await runScenarioGeneration({
            description: "Forest plus a Black Lotus",
            allowList: ALLOW_LIST,
            generate,
            resolves,
        });

        // Nothing is written here; the unknown name is surfaced for the
        // preview/edit step (ADR 0044 loadability, not legality).
        expect(result.unresolved).toEqual(["Black Lotus"]);
        // The spec is still returned (with the bad name) so the user can fix it.
        expect(result.spec.cards.map((c) => c.name)).toEqual([
            "Forest",
            "Black Lotus",
        ]);
    });

    it("also rejects an unresolved attachedTo host reference", async () => {
        const { generate } = stubGenerate(
            JSON.stringify({
                cards: [
                    {
                        name: "Wild Growth",
                        owner: "me",
                        attachedTo: "Bogus Land",
                    },
                ],
            })
        );

        const result = await runScenarioGeneration({
            description: "Wild Growth on a made-up land",
            allowList: ALLOW_LIST,
            generate,
            resolves,
        });

        expect(result.unresolved).toEqual(["Bogus Land"]);
    });

    it("propagates a non-JSON model response as an error", async () => {
        const generate = vi.fn(async () => "I refuse");
        await expect(
            runScenarioGeneration({
                description: "anything",
                allowList: ALLOW_LIST,
                generate,
                resolves,
            })
        ).rejects.toThrow(/valid JSON/);
    });
});
