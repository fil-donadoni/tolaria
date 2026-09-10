// Issue #3393 — greedy-vs-search, blade half.
//
//  1. Always-on: the report's aggregation is right on synthetic rows.
//  2. Opt-in RUNNER (gated by BLADE_GREEDY=1) — runs the registry with the
//     greedy pick and prints/writes the report. Never a gate: a greedy
//     failure asserts nothing about the bot.
//
//       BLADE_GREEDY=1 bunx vitest run --config vitest.blade.config.ts \
//         convex/gre/ai/blade/__tests__/greedy-report.spec.ts
//
//     Options: BLADE_GREEDY_TIER=must|stretch|all (default all),
//     BLADE_GREEDY_WITH_SEARCH=1 (also run the real search at each entry's
//     own budget — the must suite's full cost, ~10 min),
//     BLADE_GREEDY_OUT=<path>.json (write rows + summary),
//     BLADE_GREEDY_LABEL=<substring> (filter entries).
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import {
    collectGreedyReport,
    expectedKind,
    formatGreedyReport,
    formatGreedyRow,
    summarizeGreedyReport,
    type GreedyReportRow,
} from "../greedyReport";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

describe("greedy report aggregation (issue #3393)", () => {
    it("counts entries, seeds and entry-level agreement per tier and kind", () => {
        const leg = (ok: boolean, seedsOk: number, seeds: number) => ({
            ok,
            seedsOk,
            seeds,
            picks: [],
        });
        const rows: GreedyReportRow[] = [
            {
                label: "a",
                tier: "must",
                kind: "cast-spell",
                iterations: 400,
                greedy: leg(true, 5, 5),
                search: leg(true, 5, 5),
            },
            {
                label: "b",
                tier: "must",
                kind: "cast-spell",
                iterations: 400,
                greedy: leg(false, 1, 5),
                search: leg(true, 5, 5),
            },
            {
                label: "c",
                tier: "stretch",
                kind: "pass",
                iterations: 400,
                greedy: leg(true, 3, 3),
                search: leg(false, 0, 3),
            },
            {
                label: "d",
                tier: "must",
                kind: "pass",
                iterations: 400,
                greedy: leg(false, 0, 5),
            },
        ];
        const s = summarizeGreedyReport(rows);
        expect(s.byTier.must.greedy).toEqual({
            entries: 3,
            entriesOk: 1,
            seeds: 15,
            seedsOk: 6,
        });
        expect(s.byTier.must.search).toEqual({
            entries: 2,
            entriesOk: 2,
            seeds: 10,
            seedsOk: 10,
        });
        expect(s.byKind["cast-spell"].greedy.entriesOk).toBe(1);
        expect(s.agreement).toEqual({
            both: 1,
            greedyOnly: 1,
            searchOnly: 1,
            neither: 0,
        });
        expect(formatGreedyReport(rows, s, 1000)).toContain(
            "search-only  [must] b"
        );
        expect(formatGreedyRow(rows[1])).toContain("greedy FAIL 1/5");
    });

    it("names an entry's expected kind from its expectation shape", () => {
        const kinds = BLADE_SCENARIOS.map(expectedKind);
        expect(kinds.every((k) => k.length > 0)).toBe(true);
        expect(kinds).toContain("cast-spell");
        expect(kinds.some((k) => k.startsWith("forbidden:"))).toBe(true);
    });
});

const RUN = ENV.BLADE_GREEDY === "1";

describe.runIf(RUN)("greedy report (runner)", () => {
    it("runs the registry with the greedy pick and reports", async () => {
        const tier = ENV.BLADE_GREEDY_TIER ?? "all";
        const label = ENV.BLADE_GREEDY_LABEL;
        const withSearch = ENV.BLADE_GREEDY_WITH_SEARCH === "1";
        const scenarios = BLADE_SCENARIOS.filter(
            (s) =>
                (tier === "all" || s.tier === tier) &&
                (!label || s.label.includes(label))
        );
        const t0 = performance.now();
        const rows = collectGreedyReport(scenarios, {
            withSearch,
            onRow: (row) => console.log(formatGreedyRow(row)),
        });
        const summary = summarizeGreedyReport(rows);
        const text = formatGreedyReport(rows, summary, performance.now() - t0);
        console.log(`\n${text}`);
        const outPath = ENV.BLADE_GREEDY_OUT;
        if (outPath) {
            // Same dynamic-import trick as decisionCorpus.bot.test.ts: this
            // project is not node-typed, and vitest's reporter does not
            // reliably surface large console output.
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(
                outPath,
                JSON.stringify(
                    {
                        meta: {
                            tier,
                            label: label ?? null,
                            withSearch,
                            entries: rows.length,
                        },
                        summary,
                        text,
                        rows,
                    },
                    null,
                    2
                )
            );
            fs.writeFileSync(outPath.replace(/\.json$/, "") + ".txt", text);
        }
        expect(rows.length).toBeGreaterThan(0);
    }, 3_600_000);
});
