import { describe, it, expect } from "vitest";
import { costOf, normalizeModel } from "../lib/telemetry-db";

/**
 * Model pricing (telemetry-db.ts). The DeepSeek rows are the off-peak rates
 * from https://api-docs.deepseek.com/quick_start/pricing; the Claude rows and
 * their default cache multipliers must be untouched by the addition.
 */
describe("costOf — DeepSeek pricing", () => {
    const M = 1_000_000;

    it("bills deepseek-v4-pro input at $0.66/M and output at $1.98/M", () => {
        expect(costOf("deepseek-v4-pro", M, 0, 0, 0)).toBeCloseTo(0.66, 6);
        expect(costOf("deepseek-v4-pro", 0, M, 0, 0)).toBeCloseTo(1.98, 6);
    });

    it("bills deepseek-v4-flash input at $0.22/M and output at $0.66/M", () => {
        expect(costOf("deepseek-v4-flash", M, 0, 0, 0)).toBeCloseTo(0.22, 6);
        expect(costOf("deepseek-v4-flash", 0, M, 0, 0)).toBeCloseTo(0.66, 6);
    });

    it("bills DeepSeek cache reads at the cache-hit rate, not Claude's 0.1x", () => {
        // cache read 1M tokens at the $0.022/M hit rate, NOT 0.66 * 0.1.
        expect(costOf("deepseek-v4-pro", 0, 0, M, 0)).toBeCloseTo(0.022, 6);
        expect(costOf("deepseek-v4-flash", 0, 0, M, 0)).toBeCloseTo(0.007, 6);
    });

    it("bills DeepSeek cache writes at full input rate (cache miss), not 1.25x", () => {
        expect(costOf("deepseek-v4-pro", 0, 0, 0, M)).toBeCloseTo(0.66, 6);
    });

    it("leaves the Claude cache multipliers at their defaults", () => {
        // cache read 0.1x, cache write 1.25x — the pre-existing behaviour.
        expect(costOf("claude-sonnet-5", 0, 0, M, 0)).toBeCloseTo(0.3, 6);
        expect(costOf("claude-sonnet-5", 0, 0, 0, M)).toBeCloseTo(3.75, 6);
    });

    it("returns 0 for an unknown model", () => {
        expect(costOf("no-such-model", M, M, M, M)).toBe(0);
    });
});

describe("normalizeModel", () => {
    it("passes deepseek ids through unchanged", () => {
        expect(normalizeModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
        expect(normalizeModel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
    });

    it("strips the [1m] suffix and dated snapshots", () => {
        expect(normalizeModel("claude-opus-5[1m]")).toBe("claude-opus-5");
        expect(normalizeModel("claude-opus-5-20250829")).toBe("claude-opus-5");
    });
});
