import { describe, it, expect } from "vitest";
import {
    backfillCosts,
    costOf,
    isPricedModel,
    normalizeModel,
} from "../lib/telemetry-db";

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

/**
 * Issue #5460: the 5.5-family models carried `cost = 0` because the price
 * table stopped at the 5.0 ids; the ingest now prices every zero-cost row of a
 * known model and counts the rest.
 */
describe("backfillCosts — zero-cost llm rows (issue #5460)", () => {
    const row = (id: string, model: string) => ({
        id,
        model,
        inTok: 1_000_000,
        outTok: 200_000,
        cacheRead: 3_000_000,
        cacheWrite: 400_000,
    });

    it("prices one opus-5-5 row: 5 + 0.2*25 + 3*0.5 + 0.4*6.25 = 14.0", () => {
        const { updates, unpriced } = backfillCosts([
            row("a", "claude-opus-5-5"),
        ]);
        // in 1M*$5 + out 0.2M*$25 + cache read 3M*$5*0.1 + cache write 0.4M*$5*1.25
        expect(updates).toHaveLength(1);
        expect(updates[0].cost).toBeCloseTo(5 + 5 + 1.5 + 2.5, 6);
        expect(unpriced).toEqual([]);
    });

    it("prices the other 5.5 ids at their family's list price", () => {
        for (const m of [
            "claude-sonnet-5-5",
            "claude-fable-5-1",
            "claude-haiku-5-5",
        ])
            expect(isPricedModel(m)).toBe(true);
        expect(costOf("claude-fable-5-1", 1_000_000, 0, 0, 0)).toBeCloseTo(
            10,
            6
        );
    });

    it("leaves an unknown model at 0 and counts its rows per model", () => {
        const { updates, unpriced } = backfillCosts([
            row("a", "kimi-k3"),
            row("b", "kimi-k3"),
            row("c", "big-pickle"),
            row("d", "<synthetic>"),
        ]);
        expect(updates).toEqual([]);
        expect(unpriced).toEqual([
            { model: "kimi-k3", rows: 2 },
            { model: "big-pickle", rows: 1 },
        ]);
    });
});
