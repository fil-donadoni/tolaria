import { describe, it, expect } from "vitest";
import {
    WEEKLY_ALLOWANCE_ENV,
    attributeIssues,
    cohorts,
    formatReport,
    isNextIssueCommand,
    parseAllowance,
    resolveAllowance,
    shareStat,
    type Allowance,
    type IssueConsumption,
    type SessionConsumption,
    type WindowTotals,
} from "../lib/telemetry-budget";
import {
    costOf,
    drawsOnClaudeAllowance,
    issueFromSessionCommand,
    unitsOf,
} from "../lib/telemetry-db";

/**
 * `scripts/lib/telemetry-budget.ts` (issue #3080) — consumption as a share of
 * the weekly allowance, behind `bun run telemetry:budget`.
 *
 * Everything here is pure over plain rows: the CLI owns `bun:sqlite`, which is
 * not importable under the `node` vitest project this file runs in.
 */

function session(p: Partial<SessionConsumption>): SessionConsumption {
    return {
        session: "s",
        cmd: null,
        units: 0,
        usd: 0,
        nonClaudeUsd: 0,
        ...p,
    };
}

const ALLOWANCE: Allowance = { unitsPerWeek: 1_000_000_000, source: "--test" };

describe("parseAllowance", () => {
    it("reads a plain number of units", () => {
        expect(parseAllowance("1079000000")).toBe(1_079_000_000);
    });

    it("reads the M and G suffixes, either case", () => {
        expect(parseAllowance("1.08G")).toBeCloseTo(1.08e9, 0);
        expect(parseAllowance("500m")).toBe(5e8);
    });

    // A denominator every percentage divides by must never come back as 0, NaN
    // or Infinity — each of those produces a number-shaped lie rather than an
    // absence, which is the exact failure issue #3080 exists to fix.
    it.each([
        ["", "empty"],
        ["  ", "blank"],
        ["nonsense", "not a number"],
        ["0", "zero is not a budget of nothing"],
        ["-5", "negative"],
        ["1e9", "exponent notation is not accepted"],
        ["1.08 GB", "an unknown suffix"],
    ])("returns null for %j (%s)", (raw) => {
        expect(parseAllowance(raw)).toBeNull();
    });

    it("returns null for a missing value rather than throwing", () => {
        expect(parseAllowance(null)).toBeNull();
        expect(parseAllowance(undefined)).toBeNull();
    });
});

describe("resolveAllowance", () => {
    it("prefers the flag over the environment", () => {
        expect(resolveAllowance({ flag: "2G", env: "1G" })).toEqual({
            unitsPerWeek: 2e9,
            source: "--allowance",
        });
    });

    it("falls back to the environment, naming it", () => {
        expect(resolveAllowance({ flag: null, env: "1G" })).toEqual({
            unitsPerWeek: 1e9,
            source: `$${WEEKLY_ALLOWANCE_ENV}`,
        });
    });

    it("degrades to null — never to a percentage — when nothing is set", () => {
        expect(resolveAllowance({ flag: null, env: null })).toBeNull();
    });

    // An unparsable flag must not fall through to a stale env value: the user
    // would read a share computed against a denominator they thought they had
    // just overridden, and the CLI only warns when the resolution came back
    // empty — so nothing on screen would say the override was rejected.
    it("does not fall back to the environment when the flag is unusable", () => {
        expect(resolveAllowance({ flag: "oops", env: "1G" })).toBeNull();
        expect(resolveAllowance({ flag: "oops", env: "also-oops" })).toBeNull();
    });

    // …but an ABSENT flag is not a rejected one, in either of its two shapes.
    it("still consults the environment when no flag was given", () => {
        expect(resolveAllowance({ env: "1G" })?.unitsPerWeek).toBe(1e9);
        expect(resolveAllowance({ flag: null, env: "1G" })?.unitsPerWeek).toBe(
            1e9
        );
    });
});

describe("issueFromSessionCommand", () => {
    it("reads the issue a /next-issue session opened", () => {
        expect(issueFromSessionCommand("/next-issue 3080")).toBe(3080);
        expect(issueFromSessionCommand("/next-issue #3080")).toBe(3080);
        expect(issueFromSessionCommand("/next-issue figli di 2064")).toBe(2064);
    });

    // The legacy batch shape worked several issues in one session and no split
    // between them is recoverable. Charging the whole session to whichever
    // number came first would inflate that issue and erase the others.
    it("refuses a command naming more than one issue", () => {
        expect(
            issueFromSessionCommand("/process-gh-issues #2469 poi #2468")
        ).toBeNull();
    });

    it("refuses anything that is not a slash command", () => {
        expect(issueFromSessionCommand("please fix 3080")).toBeNull();
        expect(issueFromSessionCommand(null)).toBeNull();
    });

    it("refuses a slash command with no issue number", () => {
        expect(issueFromSessionCommand("/compact")).toBeNull();
        expect(issueFromSessionCommand("/next-issue")).toBeNull();
    });

    it("ignores numbers outside issue range", () => {
        expect(issueFromSessionCommand("/loop 5")).toBeNull();
        expect(issueFromSessionCommand("/x 123456")).toBeNull();
    });

    // A `\b` boundary reads `/mtg-rules-check 704.5a` as issue 704 and merges
    // that session's whole cost into a real issue #704 — inside the very cohort
    // ADR 0110's target is measured against.
    it("refuses a number that is a fragment of a longer token", () => {
        expect(issueFromSessionCommand("/mtg-rules-check 704.5a")).toBeNull();
        expect(issueFromSessionCommand("/cr 605.1a")).toBeNull();
        expect(issueFromSessionCommand("/loop 45m /foo")).toBeNull();
        expect(issueFromSessionCommand("/x v2 and 1.3.9")).toBeNull();
        expect(issueFromSessionCommand("/x on 2026-09-05")).toBeNull();
    });

    it("still reads a number delimited by ordinary punctuation", () => {
        expect(issueFromSessionCommand("/next-issue (3080)")).toBe(3080);
        expect(issueFromSessionCommand("/next-issue 3080, poi basta")).toBe(
            3080
        );
    });
});

describe("isNextIssueCommand", () => {
    it("recognises the ADR 0110 pipeline and nothing else", () => {
        expect(isNextIssueCommand("/next-issue 3080")).toBe(true);
        expect(isNextIssueCommand("/next-issues 3080")).toBe(false);
        expect(isNextIssueCommand("/process-gh-issues 3080")).toBe(false);
        expect(isNextIssueCommand(null)).toBe(false);
    });
});

describe("unitsOf / drawsOnClaudeAllowance", () => {
    // The store is not single-vendor: opencode contributes DeepSeek and Kimi
    // rows that cost real money and draw on no Claude allowance. Counting them
    // would inflate every share.
    it("excludes models that draw on no Claude allowance", () => {
        expect(drawsOnClaudeAllowance("deepseek-v4-pro")).toBe(false);
        expect(drawsOnClaudeAllowance("kimi-k3")).toBe(false);
        expect(drawsOnClaudeAllowance("<synthetic>")).toBe(false);
        expect(unitsOf("deepseek-v4-pro", 1e6, 1e6, 1e6, 1e6)).toBe(0);
    });

    it("counts Claude models, including the bare tier aliases", () => {
        expect(drawsOnClaudeAllowance("claude-opus-5")).toBe(true);
        expect(drawsOnClaudeAllowance("sonnet")).toBe(true);
        expect(drawsOnClaudeAllowance("claude-sonnet-5-20260101")).toBe(true);
        expect(unitsOf("claude-sonnet-5", 1000, 0, 0, 0)).toBe(1000);
    });

    // The unit is anchored at "1 unit == 1 Sonnet input token" — that anchor is
    // what makes a share comparable with the AFK guard's own budget.
    it("anchors one unit at one Sonnet input token", () => {
        expect(unitsOf("claude-sonnet-5", 1, 0, 0, 0)).toBe(1);
        expect(unitsOf("claude-sonnet-5", 0, 1, 0, 0)).toBe(5);
        expect(unitsOf("claude-sonnet-5", 0, 0, 1, 0)).toBeCloseTo(0.1, 10);
        expect(unitsOf("claude-sonnet-5", 0, 0, 0, 1)).toBeCloseTo(1.25, 10);
    });

    // An unrecognised CLAUDE model keeps classifyModel's fail-expensive
    // fallback: reporting a new model as cheap is the one error that would let
    // a runaway look affordable.
    it("prices an unknown Claude model as the most expensive class", () => {
        expect(unitsOf("claude-titan-9", 1, 0, 0, 0)).toBe(
            unitsOf("claude-fable-5", 1, 0, 0, 0)
        );
    });

    // On CLAUDE rows the two currencies are proportional by construction — the
    // weight table is list price / 3 — so the share does not depend on which is
    // divided. Guarding it keeps the two tables from drifting apart silently.
    it("keeps the same model ratios as list price, on Claude rows", () => {
        const ratioUsd =
            costOf("claude-opus-5", 0, 1e6, 0, 0) /
            costOf("claude-sonnet-5", 1e6, 0, 0, 0);
        const ratioUnits =
            unitsOf("claude-opus-5", 0, 1e6, 0, 0) /
            unitsOf("claude-sonnet-5", 1e6, 0, 0, 0);
        expect(ratioUnits).toBeCloseTo(ratioUsd, 2);
    });

    // …and that proportionality is a property of today's table, not a
    // guarantee. The store already breaks it: a DeepSeek row has real
    // list-price dollars and exactly zero allowance units, which is why the
    // report may never quote one currency in place of the other.
    it("breaks that proportionality on a non-Claude row", () => {
        expect(costOf("deepseek-v4-pro", 1e6, 1e6, 0, 0)).toBeGreaterThan(0);
        expect(unitsOf("deepseek-v4-pro", 1e6, 1e6, 0, 0)).toBe(0);
    });
});

describe("attributeIssues", () => {
    it("sums every session that named the same issue", () => {
        const rows = attributeIssues(
            [
                session({ session: "a", cmd: "/next-issue 3080", units: 10 }),
                session({ session: "b", cmd: "/next-issue 3080", units: 5 }),
            ],
            new Map(),
            null
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ issue: 3080, units: 15, sessions: 2 });
    });

    it("drops sessions no command attributes", () => {
        const rows = attributeIssues(
            [
                session({ cmd: "/next-issue 3080", units: 10 }),
                session({ cmd: null, units: 999 }),
                session({ cmd: "/process-gh-issues 1 e 2", units: 999 }),
            ],
            new Map(),
            null
        );
        expect(rows.map((r) => r.issue)).toEqual([3080]);
        expect(rows[0].units).toBe(10);
    });

    it("leaves every share null when no allowance is configured", () => {
        const rows = attributeIssues(
            [session({ cmd: "/next-issue 3080", units: 1e7 })],
            new Map(),
            null
        );
        expect(rows[0].sharePct).toBeNull();
    });

    it("divides units — not dollars — into the allowance", () => {
        const rows = attributeIssues(
            [session({ cmd: "/next-issue 3080", units: 1e7, usd: 999 })],
            new Map(),
            ALLOWANCE
        );
        expect(rows[0].sharePct).toBeCloseTo(1, 10);
    });

    it("carries issue state and the /next-issue flag", () => {
        const rows = attributeIssues(
            [
                session({ cmd: "/next-issue 3080", units: 2 }),
                session({ cmd: "/audit-tracker 2000", units: 1 }),
            ],
            new Map([[3080, "closed"]]),
            null
        );
        expect(rows.find((r) => r.issue === 3080)).toMatchObject({
            state: "closed",
            nextIssue: true,
        });
        expect(rows.find((r) => r.issue === 2000)).toMatchObject({
            state: null,
            nextIssue: false,
        });
    });

    it("sorts costliest first", () => {
        const rows = attributeIssues(
            [
                session({ cmd: "/next-issue 44", units: 1 }),
                session({ cmd: "/next-issue 22", units: 9 }),
                session({ cmd: "/next-issue 333", units: 5 }),
            ],
            new Map(),
            null
        );
        expect(rows.map((r) => r.issue)).toEqual([22, 333, 44]);
    });
});

describe("shareStat", () => {
    // max, not mean: the failure mode is the runaway tail — a single issue
    // reached $1095 against a $59 median under the orchestrator — and a mean
    // both hides it and is dragged by it.
    it("reports the maximum, which a mean would hide", () => {
        expect(shareStat([1, 1, 1, 1, 100])).toMatchObject({
            median: 1,
            max: 100,
            n: 5,
        });
    });

    it("uses nearest-rank quantiles, so every figure is an observation", () => {
        const s = shareStat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(s.median).toBe(5);
        expect(s.p90).toBe(9);
    });

    it("is inert on an empty set", () => {
        expect(shareStat([])).toEqual({ median: 0, p90: 0, max: 0, n: 0 });
    });
});

describe("cohorts", () => {
    const issue = (p: Partial<IssueConsumption>): IssueConsumption => ({
        issue: 1,
        units: 1,
        usd: 1,
        sessions: 1,
        state: null,
        nextIssue: false,
        sharePct: null,
        ...p,
    });

    it("narrows to closed /next-issue issues first — the target's population", () => {
        const rows = [
            issue({ issue: 1, nextIssue: true, state: "closed" }),
            issue({ issue: 2, nextIssue: true, state: "open" }),
            issue({ issue: 3, nextIssue: false, state: "closed" }),
        ];
        const c = cohorts(rows);
        expect(c[0].issues.map((r) => r.issue)).toEqual([1]);
        expect(c[1].issues.map((r) => r.issue)).toEqual([1, 2]);
        expect(c[2].issues.map((r) => r.issue)).toEqual([1, 2, 3]);
    });
});

describe("formatReport", () => {
    const totals: WindowTotals = {
        units: 1e8,
        usd: 300,
        nonClaudeUsd: 14,
        unattributedUnits: 2e7,
        days: 7,
    };
    const rows = attributeIssues(
        [
            session({ cmd: "/next-issue 3080", units: 1e7, usd: 30 }),
            session({ cmd: "/next-issue 3079", units: 2e7, usd: 60 }),
        ],
        new Map([
            [3080, "closed"],
            [3079, "closed"],
        ]),
        ALLOWANCE
    );

    it("says the share is unavailable rather than printing a number", () => {
        const noAllowance = attributeIssues(
            [session({ cmd: "/next-issue 3080", units: 1e7, usd: 30 })],
            new Map([[3080, "closed"]]),
            null
        );
        const text = formatReport(
            "2026-09-01",
            "2026-09-07",
            totals,
            null,
            cohorts(noAllowance),
            0.5
        );
        expect(text).toContain("NOT CONFIGURED");
        expect(text).toContain("UNEVALUATED");
        expect(text).toContain("n/a");
        expect(text).not.toMatch(/share of weekly allowance.*\d+\.\d+%/);
    });

    it("labels each currency so the two are never read as one", () => {
        const text = formatReport(
            "2026-09-01",
            "2026-09-07",
            totals,
            ALLOWANCE,
            cohorts(rows),
            0.5
        );
        expect(text).toContain("list price (not a share)");
        expect(text).toContain("API-equivalent — NOT a share of anything");
        expect(text).toContain("draws on no Claude allowance");
        expect(text).toContain("share of weekly allowance");
    });

    it("names the allowance's provenance and that it is declared", () => {
        const text = formatReport(
            "2026-09-01",
            "2026-09-07",
            totals,
            ALLOWANCE,
            cohorts(rows),
            0.5
        );
        expect(text).toContain("--test");
        expect(text).toContain("not a quota reading");
    });

    it("calls the target NOT MET when the median exceeds it", () => {
        const text = formatReport(
            "2026-09-01",
            "2026-09-07",
            totals,
            ALLOWANCE,
            cohorts(rows),
            0.5
        );
        // 1e7 and 2e7 against a 1e9 allowance: 1.00% and 2.00%. The median is
        // nearest-rank, so on an even-sized set it is the LOWER of the two
        // middle observations — 1.00%, and still over the 0.5% target.
        expect(text).toContain("NOT MET (median 1.00%)");
    });

    it("calls it MET when the median is inside it", () => {
        const cheap = attributeIssues(
            [session({ cmd: "/next-issue 3080", units: 1e6, usd: 3 })],
            new Map([[3080, "closed"]]),
            ALLOWANCE
        );
        const text = formatReport(
            "2026-09-01",
            "2026-09-07",
            totals,
            ALLOWANCE,
            cohorts(cheap),
            0.5
        );
        expect(text).toContain("MET (median 0.10%)");
        expect(text).not.toContain("NOT MET");
    });
});
