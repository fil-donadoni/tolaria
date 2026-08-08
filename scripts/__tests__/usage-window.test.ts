import { describe, it, expect } from "vitest";

import {
    parseUsageLine,
    sumWindow,
    weightedTokens,
    pctOfBudget,
    classifyModel,
    DEFAULT_WEIGHTS,
    MOST_EXPENSIVE_WEIGHT_CLASS,
    type UsageRecord,
} from "../lib/usage-window";

/**
 * `scripts/lib/usage-window.ts` is the pure accounting core behind
 * `bun run usage:window` and, transitively, `scripts/loop-drain.sh`'s budget
 * guard (PRD: the AFK driver, ADR 0097). Every case here guards a real way an
 * unattended loop could either burn money silently or stop for no reason.
 */

const line = (obj: unknown): string => JSON.stringify(obj);

const usageLine = (over: {
    ts?: string;
    model?: string;
    usage?: Record<string, unknown>;
}) =>
    line({
        timestamp: over.ts ?? "2026-08-08T10:00:00.000Z",
        message: {
            model: over.model ?? "claude-sonnet-5-20260101",
            usage: {
                input_tokens: 2,
                output_tokens: 135,
                cache_creation_input_tokens: 643,
                cache_read_input_tokens: 115288,
                ...(over.usage ?? {}),
            },
        },
    });

describe("parseUsageLine — the iterations double-count trap", () => {
    it("reads ONLY the top-level usage fields, ignoring a matching iterations array", () => {
        // Pins the exact trap described in the task: `usage.iterations[]`
        // repeats the SAME numbers as the top-level fields under the same
        // key names. A parser that also walked `iterations` and summed it in
        // would silently double (or worse) every line's contribution.
        const raw = line({
            timestamp: "2026-08-08T10:00:00.000Z",
            message: {
                model: "claude-sonnet-5-20260101",
                usage: {
                    input_tokens: 2,
                    cache_creation_input_tokens: 643,
                    cache_read_input_tokens: 115288,
                    output_tokens: 135,
                    cache_creation: {
                        ephemeral_1h_input_tokens: 643,
                        ephemeral_5m_input_tokens: 0,
                    },
                    iterations: [
                        {
                            input_tokens: 2,
                            output_tokens: 135,
                            cache_read_input_tokens: 115288,
                            cache_creation_input_tokens: 643,
                            type: "message",
                        },
                    ],
                },
            },
        });

        const rec = parseUsageLine(raw);
        expect(rec).not.toBeNull();
        expect(rec).toEqual({
            tsMs: Date.parse("2026-08-08T10:00:00.000Z"),
            model: "claude-sonnet-5-20260101",
            input: 2,
            output: 135,
            cacheCreation: 643,
            cacheRead: 115288,
        });
    });

    it("proof-of-failure sibling: a parser that ALSO summed iterations would double every field", () => {
        // Not a real code path — a direct demonstration of the trap's shape,
        // so the fixture above reads as a deliberate regression guard rather
        // than an arbitrary assertion. If parseUsageLine ever regresses to
        // include iterations, this shows what "double" looks like.
        const rec = parseUsageLine(
            usageLine({
                usage: {
                    input_tokens: 10,
                    output_tokens: 10,
                    cache_creation_input_tokens: 10,
                    cache_read_input_tokens: 10,
                    iterations: [
                        {
                            input_tokens: 10,
                            output_tokens: 10,
                            cache_creation_input_tokens: 10,
                            cache_read_input_tokens: 10,
                        },
                    ],
                },
            })
        )!;
        // The real guard: if parseUsageLine ever regressed to also sum
        // `iterations`, this would read 20, not 10.
        expect(rec.input).toBe(10);
    });
});

describe("parseUsageLine — never throws, returns null for anything unusable", () => {
    it.each([
        ["empty string", ""],
        ["whitespace only", "   \n"],
        ["not JSON", "not json at all {{{"],
        ["a JSON array", "[1,2,3]"],
        ["null", "null"],
        ["a bare number", "42"],
        [
            "a user turn (no message.usage)",
            line({ type: "user", message: { role: "user", content: "hi" } }),
        ],
        ["a tool_result line", line({ type: "tool_result", content: [] })],
        ["a summary line", line({ type: "summary", summary: "..." })],
        [
            "message present but no usage",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { model: "claude-sonnet-5" },
            }),
        ],
        [
            "usage present but no model",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { usage: { input_tokens: 1 } },
            }),
        ],
        [
            "usage present but no timestamp",
            line({
                message: {
                    model: "claude-sonnet-5",
                    usage: { input_tokens: 1 },
                },
            }),
        ],
        ["timestamp is not parseable", usageLine({ ts: "not-a-date" })],
        [
            "message is a string, not an object",
            line({ timestamp: "2026-08-08T10:00:00.000Z", message: "oops" }),
        ],
        [
            "usage is a string, not an object",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { model: "x", usage: "oops" },
            }),
        ],
    ])("%s -> null, no throw", (_label, input) => {
        expect(() => parseUsageLine(input)).not.toThrow();
        expect(parseUsageLine(input)).toBeNull();
    });

    it("tolerates missing/non-numeric numeric fields by treating them as 0", () => {
        const rec = parseUsageLine(
            usageLine({
                usage: {
                    input_tokens: "not-a-number",
                    output_tokens: null,
                    cache_creation_input_tokens: undefined,
                    cache_read_input_tokens: {},
                },
            })
        );
        expect(rec).toEqual({
            tsMs: Date.parse("2026-08-08T10:00:00.000Z"),
            model: "claude-sonnet-5-20260101",
            input: 0,
            output: 0,
            cacheCreation: 0,
            cacheRead: 0,
        });
    });
});

describe("sumWindow — the window boundary", () => {
    const at = (tsMs: number, model = "claude-sonnet-5"): UsageRecord => ({
        tsMs,
        model,
        input: 1,
        output: 1,
        cacheCreation: 1,
        cacheRead: 1,
    });

    it("includes a record exactly AT sinceMs (closed left edge)", () => {
        const sinceMs = 1000;
        const { totals } = sumWindow([at(1000)], sinceMs);
        expect(totals.input).toBe(1);
    });

    it("excludes a record one millisecond before sinceMs", () => {
        const sinceMs = 1000;
        const { totals } = sumWindow([at(999)], sinceMs);
        expect(totals.input).toBe(0);
    });

    it("sums per-model AND totals across a mixed window", () => {
        const sinceMs = 1000;
        const { models, totals } = sumWindow(
            [
                at(1000, "claude-sonnet-5"),
                at(1500, "claude-sonnet-5"),
                at(2000, "claude-opus-4-5"),
                at(500, "claude-opus-4-5"), // outside window
            ],
            sinceMs
        );
        expect(models["claude-sonnet-5"]).toEqual({
            input: 2,
            output: 2,
            cacheCreation: 2,
            cacheRead: 2,
        });
        expect(models["claude-opus-4-5"]).toEqual({
            input: 1,
            output: 1,
            cacheCreation: 1,
            cacheRead: 1,
        });
        expect(totals).toEqual({
            input: 3,
            output: 3,
            cacheCreation: 3,
            cacheRead: 3,
        });
    });
});

describe("classifyModel / weightedTokens — unknown model fails expensive", () => {
    it("classifies recognised family names case-insensitively", () => {
        expect(classifyModel("claude-opus-4-5-20260101")).toBe("opus");
        expect(classifyModel("CLAUDE-SONNET-5-20260101")).toBe("sonnet");
        expect(classifyModel("claude-haiku-4-5")).toBe("haiku");
        expect(classifyModel("claude-fable-5-20260101")).toBe("fable");
        expect(classifyModel("CLAUDE-MYTHOS-5")).toBe("fable");
    });

    it("falls back an unrecognised model to the MOST expensive class", () => {
        expect(classifyModel("some-future-model-nobody-has-seen")).toBe(
            MOST_EXPENSIVE_WEIGHT_CLASS
        );
        // fable/mythos ($10/$50 per MTok) is the most expensive KNOWN class —
        // opus ($5/$25) is cheaper than that. An unknown model must fall back
        // to whichever row is genuinely priciest, not to opus by habit.
        expect(MOST_EXPENSIVE_WEIGHT_CLASS).toBe("fable");
    });

    it("weights an unknown model as if it were fable, never as a cheaper class (opus included)", () => {
        const unknownSum = {
            models: {
                "brand-new-model-xyz": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownFableSum = {
            models: {
                "claude-fable-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownOpusSum = {
            models: {
                "claude-opus-4-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownSonnetSum = {
            models: {
                "claude-sonnet-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const unknownWeighted = weightedTokens(unknownSum);
        expect(unknownWeighted).toBe(weightedTokens(knownFableSum));
        // The load-bearing part of this fix: an unknown model must weight
        // STRICTLY MORE than opus, not the same — opus is no longer the most
        // expensive known class, so an unknown model landing on the opus
        // weight (as it used to) would silently look cheaper than it should.
        expect(unknownWeighted).toBeGreaterThan(weightedTokens(knownOpusSum));
        // Proof it fails EXPENSIVE, not cheap: strictly more than the sonnet
        // weighting of the identical raw counts.
        expect(unknownWeighted).toBeGreaterThan(weightedTokens(knownSonnetSum));
    });

    it("DEFAULT_WEIGHTS anchors sonnet input at 1 and prices opus output above sonnet output", () => {
        expect(DEFAULT_WEIGHTS.sonnet.input).toBe(1);
        expect(DEFAULT_WEIGHTS.opus.output).toBeGreaterThan(
            DEFAULT_WEIGHTS.sonnet.output
        );
        // Cache reads are meant to be an order of magnitude cheaper than a
        // fresh input token, for every class.
        for (const cls of Object.values(DEFAULT_WEIGHTS)) {
            expect(cls.cacheRead).toBeLessThan(cls.input);
        }
    });

    it("opus is priced at $5/$25 (Opus 5), not $15/$75 (a stale Opus 4.1/4-era row)", () => {
        // Regression pin: a prior fixup left this row at list-price ÷ 3 for
        // $15/$75 output (5/25) while claiming in a comment it was "exact"
        // against CURRENT list price — it wasn't, current Opus 5 list price
        // is $5/$25. sonnet.input == 1 is $3/MTok, so opus at $5/MTok must
        // land at 5/3 ≈ 1.67, not 5. Table values are rounded to 2-3 decimal
        // places, so compare with a tolerance rather than bit-exact.
        expect(DEFAULT_WEIGHTS.opus.input).toBeCloseTo(5 / 3, 1);
        expect(DEFAULT_WEIGHTS.opus.output).toBeCloseTo(25 / 3, 1);
    });

    it("fable is priced at $10/$50 per MTok, the genuinely most expensive class", () => {
        expect(DEFAULT_WEIGHTS.fable.input).toBeCloseTo(10 / 3, 1);
        expect(DEFAULT_WEIGHTS.fable.output).toBeCloseTo(50 / 3, 1);
        expect(DEFAULT_WEIGHTS.fable.input).toBeGreaterThan(
            DEFAULT_WEIGHTS.opus.input
        );
        expect(DEFAULT_WEIGHTS.fable.output).toBeGreaterThan(
            DEFAULT_WEIGHTS.opus.output
        );
    });

    it("cache write is ~1.25x input and cache read is ~0.1x input for every class", () => {
        // Sonnet/haiku are exact ÷3 rounding, so tight; opus/fable are
        // rounded to fewer significant figures in the table, so a looser
        // tolerance — the point is the RELATIONSHIP holds, not bit-exactness.
        for (const cls of Object.values(DEFAULT_WEIGHTS)) {
            expect(cls.cacheCreation).toBeCloseTo(cls.input * 1.25, 1);
            expect(cls.cacheRead).toBeCloseTo(cls.input * 0.1, 1);
        }
    });
});

describe("pctOfBudget — never divides by zero, never returns Infinity", () => {
    it("returns 0 for a zero budget", () => {
        expect(pctOfBudget(999, 0)).toBe(0);
    });

    it("returns 0 for a negative budget", () => {
        expect(pctOfBudget(999, -5)).toBe(0);
    });

    it("computes a normal percentage otherwise", () => {
        expect(pctOfBudget(50, 200)).toBe(25);
    });

    it("never returns Infinity or NaN for any budget <= 0", () => {
        for (const budget of [0, -1, -0]) {
            const pct = pctOfBudget(123, budget);
            expect(Number.isFinite(pct)).toBe(true);
        }
    });
});
