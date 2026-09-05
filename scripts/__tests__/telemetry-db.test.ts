import { describe, it, expect } from "vitest";
import {
    costOf,
    llmDedupeSql,
    normalizeModel,
    RESPONSE_IDENTITY_COLUMNS,
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
 * Response identity (issue #3078). One API response with several content
 * blocks writes one transcript line per block, each repeating the response's
 * full usage payload; keying `llm` on the per-line `uuid` billed it once per
 * block. New rows key on `message.id`, and the rows ingested before that fix
 * carry no response id at all — so the one-time migration has to recognise a
 * repeat from its payload, and these columns are the whole of that judgment.
 */
describe("RESPONSE_IDENTITY_COLUMNS", () => {
    it("includes every usage counter, so two distinct responses never merge", () => {
        // These are the four fields that MOVE between consecutive responses:
        // the later prompt contains the earlier output. Dropping any one lets
        // the migration delete a real response that agreed on the rest.
        for (const col of ["in_tok", "out_tok", "cache_read", "cache_write"]) {
            expect(RESPONSE_IDENTITY_COLUMNS).toContain(col);
        }
    });

    it("scopes a group to one session, surface and instant", () => {
        // Without these, two sessions' equally-sized responses collapse into
        // one row and a whole session's cost silently disappears.
        for (const col of ["session", "harness", "agent_id", "surface", "ts"]) {
            expect(RESPONSE_IDENTITY_COLUMNS).toContain(col);
        }
    });
});

describe("llmDedupeSql", () => {
    it("keeps one row per response and deletes only the repeats", () => {
        const sql = llmDedupeSql();
        expect(sql).toContain("DELETE FROM llm WHERE uuid NOT IN");
        expect(sql).toContain("SELECT min(uuid) FROM llm GROUP BY");
    });

    it("groups by exactly the identity columns, never a hand-written list", () => {
        // The statement is generated from the constant, so a column added there
        // reaches the migration without anyone editing SQL.
        const groupBy = llmDedupeSql().split("GROUP BY ")[1].replace(")", "");
        expect(groupBy.split(", ")).toEqual([...RESPONSE_IDENTITY_COLUMNS]);
    });
});
