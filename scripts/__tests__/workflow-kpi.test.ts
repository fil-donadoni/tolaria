import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
    classifyLandFailure,
    computeWorkflowKpis,
    formatKpiLines,
    kpiBreaches,
    landLogMerged,
    parseDetachLine,
    parseDuration,
    parseKpiThresholds,
    redHours,
    type KpiThresholds,
} from "../lib/workflow-kpi";
import { CONFIG_PATH } from "../lib/branches";

/**
 * The four workflow KPIs (issue #4968) — the pure half. The database half
 * (ingest, rotation, the attempt history) is `telemetry-ingest-quick.test.ts`.
 */

const H = 3600;
const D = 86400;

describe("classifyLandFailure — the stage a non-green land stopped in", () => {
    // Shapes copied from real `~/.cache/tolaria/gate-runs/land-*/log` files.
    it("charges a stopped rebase to `rebase`", () => {
        const log = [
            "[gate] acquired the heavy mutex after 7s",
            "Could not apply f6b3f12... # Bot: refit (issue #4900)",
            "convex/gre/ai/evalWeights.ts",
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("rebase");
    });

    it("charges a failed vitest project in the lane to `vitest`", () => {
        const log = [
            "lane: ran",
            " FAIL  |node-engine| scripts/__tests__/x.test.ts > y",
            "  ✗ check:pr  446.4s",
            'error: script "check:lane" exited with code 1',
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("vitest");
    });

    it("charges any other lane failure (tsc, lint, cr:lint) to `static`", () => {
        const log = [
            "lane: ran",
            "  ✗ cr:lint  3.1s",
            "FAIL  3.1s total",
            'error: script "check:lane" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("static");
    });

    it("charges a red preflight to the lane too", () => {
        const log =
            "land: preflight is red on the PR's own head (`check:lane --preflight`, exit 1) — …";
        expect(classifyLandFailure(log)).toBe("static");
    });

    it("charges a lane that passed and a merge that did not to `merge`", () => {
        const log = [
            "lane: ran",
            " + 05eec729c...34d8ad7bf fix/issue-4286 -> fix/issue-4286 (forced update)",
            "pr-merge: PR is closed",
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("merge");
    });

    it("separates a refusal before the queue, colour codes and all", () => {
        const log =
            "\u001b[0m\u001b[31mland: refusing — the health gate is RED and this PR is not a declared repair";
        expect(classifyLandFailure(log)).toBe("refused");
    });

    it("never charges the PR for a saturated machine or a killed run", () => {
        expect(
            classifyLandFailure(
                "land: NOT landed, and NOT failed — the machine stayed saturated"
            )
        ).toBe("infra");
        expect(
            classifyLandFailure(
                'lane: ran\nerror: script "land" was terminated by signal SIGTERM'
            )
        ).toBe("infra");
    });

    it("falls back to `other`", () => {
        expect(
            classifyLandFailure(
                'fatal: not a git repository\nerror: script "land" exited with code 128'
            )
        ).toBe("other");
    });

    it("reads a merge in the log as a landing, marker or not", () => {
        expect(landLogMerged("pr-merge: PR #4881 merged (attempt 1)")).toBe(
            true
        );
        expect(landLogMerged("pr-merge: PR #4881 is merged")).toBe(true);
        expect(landLogMerged("pr-merge: PR is closed")).toBe(false);
    });
});

describe("redHours — RED from a red verdict to the next green", () => {
    const w = { from: 0, to: 10 * H };

    it("counts each red stretch up to the GREEN that ends it", () => {
        const v = [
            { ts: 1 * H, red: true },
            { ts: 2 * H, red: true },
            { ts: 4 * H, red: false },
            { ts: 6 * H, red: true },
            { ts: 7 * H, red: false },
        ];
        expect(redHours(v, w)).toBe(4);
    });

    it("keeps an unended red to the window's end, and a red before the window opens it red", () => {
        expect(redHours([{ ts: 8 * H, red: true }], w)).toBe(2);
        expect(
            redHours(
                [
                    { ts: -5 * H, red: true },
                    { ts: 3 * H, red: false },
                ],
                w
            )
        ).toBe(3);
    });
});

describe("computeWorkflowKpis", () => {
    const w = { from: 0, to: 2 * D };
    const k = computeWorkflowKpis(
        {
            lands: [
                { started: 10, green: true, bucket: null },
                { started: 20, green: false, bucket: "vitest" },
                { started: 30, green: false, bucket: "rebase" },
                { started: 40, green: false, bucket: null },
                { started: 3 * D, green: false, bucket: "static" }, // outside
            ],
            health: [
                { ts: 100, red: false },
                { ts: 200, red: true },
                { ts: 300, red: false },
                { ts: 3 * D, red: true }, // outside
            ],
            waits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => ({
                ts: s,
                waitedMs: s * 1000,
            })),
        },
        w
    );

    it("counts only what started inside the window, by bucket", () => {
        expect(k.lands).toBe(4);
        expect(k.failed).toBe(3);
        expect(k.failedPct).toBe(75);
        expect(k.byBucket.vitest).toBe(1);
        expect(k.byBucket.rebase).toBe(1);
        expect(k.byBucket.unknown).toBe(1);
        expect(k.byBucket.static).toBe(0);
    });

    it("rates health runs per day and takes nearest-rank percentiles", () => {
        expect(k.healthRuns).toBe(3);
        expect(k.healthRed).toBe(1);
        expect(k.healthRunsPerDay).toBe(1.5);
        expect(k.waitP50S).toBe(5);
        expect(k.waitP90S).toBe(9);
    });

    it("prints exactly four lines per window", () => {
        const lines = formatKpiLines(k, " 7d");
        expect(lines).toHaveLength(4);
        expect(lines[0]).toContain(
            "3/4 (75.0%) — rebase 1, vitest 1, unknown 1"
        );
    });
});

describe("thresholds — tolaria.config.json § workflow", () => {
    it("parses the committed config", () => {
        const t = parseKpiThresholds(readFileSync(CONFIG_PATH, "utf8"));
        for (const v of Object.values(t)) expect(v).toBeGreaterThan(0);
    });

    it("refuses a missing or non-positive ceiling", () => {
        expect(() => parseKpiThresholds("{}")).toThrow(/missing "workflow"/);
        expect(() =>
            parseKpiThresholds(
                JSON.stringify({
                    workflow: {
                        failedLandPctMax: 0,
                        redHoursPerDayMax: 1,
                        healthRunsPerDayMax: 1,
                        mutexWaitP90SMax: 1,
                    },
                })
            )
        ).toThrow(/failedLandPctMax/);
    });

    it("names every KPI over its ceiling, and none under it", () => {
        const t: KpiThresholds = {
            failedLandPctMax: 15,
            redHoursPerDayMax: 2,
            healthRunsPerDayMax: 4,
            mutexWaitP90SMax: 900,
        };
        const over = computeWorkflowKpis(
            {
                lands: [
                    { started: 1, green: false, bucket: "static" },
                    { started: 2, green: true, bucket: null },
                ],
                health: [{ ts: 1, red: true }],
                waits: [{ ts: 1, waitedMs: 1_000_000 }],
            },
            { from: 0, to: D }
        );
        expect(kpiBreaches(over, t)).toHaveLength(3);
        const ok = computeWorkflowKpis(
            {
                lands: [{ started: 1, green: true, bucket: null }],
                health: [{ ts: 1, red: false }],
                waits: [{ ts: 1, waitedMs: 1000 }],
            },
            { from: 0, to: D }
        );
        expect(kpiBreaches(ok, t)).toEqual([]);
    });
});

describe("detach.log lines", () => {
    it("parses durations as health-main prints them", () => {
        expect(parseDuration("45s")).toBe(45);
        expect(parseDuration("6m12s")).toBe(372);
        expect(parseDuration("1h02m")).toBe(3720);
        expect(parseDuration("")).toBeNull();
        expect(parseDuration("soon")).toBeNull();
    });

    it("keeps step durations, fire reasons and verdicts; drops progress", () => {
        expect(
            parseDetachLine("health-main: [5/5] test — exit 0 after 9m41s")
        ).toEqual({ kind: "step", step: "test", exit: "0", secs: 581 });
        expect(
            parseDetachLine(
                "health-cadence: firing on count — 5 landings since the last GREEN (threshold 5); gating aa785cf0"
            )
        ).toEqual({
            kind: "fire",
            trigger: "count",
            reason: "5 landings since the last GREEN (threshold 5); gating aa785cf0",
        });
        expect(
            parseDetachLine("health-main: RED @ 335e4685 (test) — /x.log")
        ).toEqual({ kind: "verdict", verdict: "RED", sha: "335e4685" });
        expect(
            parseDetachLine(
                "health-main: [5/5] test — still running, 2m00s elapsed"
            )
        ).toBeNull();
    });
});
