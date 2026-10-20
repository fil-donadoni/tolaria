import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PassRecord } from "../lib/afk-dispatch";
import {
    LANDING_CAUSES,
    commentCause,
    flakyRows,
    landingEpisodes,
    laneRecord,
    machineTrend,
    parseMachineReading,
    passCost,
    passLatency,
    percentile,
    queueHours,
    redEpisodes,
    redSummary,
    summaryMarkdown,
    weeklyTrends,
    type HistoryNode,
    type PrTimeline,
    type QueueRun,
    type TrendFacts,
} from "../lib/workflow-trends";

/**
 * The weekly report's aggregation (issue #5651). `pr-timelines.json` and
 * `base-history.json` are GitHub's own answers to `weekly-report.ts`'s
 * queries, recorded 2026-10-20 (comment bodies cut to their marker lines);
 * `machine-huawei.json` is that machine's real reading of the week. No
 * `afk-pass` record, `lane.json` artifact or telemetry with rows existed yet:
 * those fixtures are written in the shape their writers produce
 * (`passRecord`, `check:lane --json --retry-flaky`, `telemetry:budget
 * --json`, `telemetry:latency --json`).
 */

const DIR = join(__dirname, "fixtures", "workflow-trends");
const text = (name: string) => readFileSync(join(DIR, name), "utf8");
const json = <T>(name: string) => JSON.parse(text(name)) as T;

const WINDOW = { from: "2026-10-18T10:30:00Z", to: "2026-10-20T10:30:00Z" };
const PRS = json<PrTimeline[]>("pr-timelines.json");
const HISTORY = json<HistoryNode[]>("base-history.json");
const PASSES = json<PassRecord[]>("pass-records.json");

function facts(over: Partial<TrendFacts> = {}): TrendFacts {
    return {
        window: WINDOW,
        prs: PRS,
        issuesOpened: 50,
        issuesClosed: 95,
        history: HISTORY,
        escalations: ["RED ladder stopped @ 4db4ed91"],
        flakyIssues: [],
        queueRuns: [],
        passes: PASSES,
        passRecordsMissing: 0,
        machines: [],
        ...over,
    };
}

const run = (
    pr: number,
    updatedAt: string,
    lane: string | null,
    conclusion = "failure"
): QueueRun => ({ pr, conclusion, updatedAt, ...laneRecord(lane) });

describe("commentCause — the comment posted with a `land-failed` label", () => {
    const bodies = PRS.flatMap((p) =>
        p.timelineItems.nodes.flatMap((i) =>
            i.__typename === "IssueComment" ? [i.body] : []
        )
    );
    const first = (re: RegExp) => {
        const b = bodies.find((x) => re.test(x));
        if (b === undefined) throw new Error(`no recorded comment ${re}`);
        return b;
    };

    it("reads each recorded marker as its Amendment I cause", () => {
        expect(commentCause(first(/^\*\*pr-refresh: rebase onto/))).toBe(
            "rebase"
        );
        expect(commentCause(first(/^\*\*merge queue: dequeued/))).toBe(
            "red-lane"
        );
        expect(commentCause(first(/refusal is red/))).toBe("defect");
        expect(commentCause(first(/health gate is RED/))).toBe("red-base");
        expect(commentCause(first(/no fixup row/))).toBe("defect");
    });

    it("a timed-out queue check is the machine's; other comments label nothing", () => {
        expect(
            commentCause(
                "**merge queue: dequeued (`CHECKS_TIMEOUT`)** — labelled `land-failed`."
            )
        ).toBe("environment");
        expect(commentCause(first(/Mergify Payload/))).toBeNull();
        expect(commentCause(first(/land-runner: merged/))).toBeNull();
    });
});

describe("landingEpisodes — episodes, not attempts", () => {
    it("charges each recorded episode once, and none from before the window", () => {
        expect(
            landingEpisodes(facts()).map((e) => [e.pr, e.at, e.cause])
        ).toEqual([
            // Its second label (12:19:58) is the same head, same reason.
            [5937, "2026-10-18T12:18:41Z", "red-base"],
            // 16:48:31 is the same head, same reason: no push since 13:08.
            [6034, "2026-10-19T13:08:29Z", "red-lane"],
            [6074, "2026-10-19T18:21:25Z", "red-lane"],
            [6086, "2026-10-19T20:38:24Z", "defect"],
            // A new head (08:02) — then Mergify re-labels at 08:54 and 08:59
            // with no comment of their own: the same episode.
            [6034, "2026-10-20T08:16:26Z", "red-lane"],
            // Force-pushed at 08:13: a new head, a new episode.
            [6086, "2026-10-20T08:17:38Z", "defect"],
            [6123, "2026-10-20T09:57:49Z", "rebase"],
        ]);
    });

    it("sub-classifies a dequeue by the draft's queue-lane JSON", () => {
        const eps = landingEpisodes(
            facts({
                queueRuns: [
                    // The lane refused before its JSON: the machine.
                    run(6034, "2026-10-19T13:07:40Z", ""),
                    run(6074, "2026-10-19T18:20:50Z", text("lane-red.json")),
                    run(6034, "2026-10-20T08:15:48Z", text("lane-stale.json")),
                    // Not the dequeuing run: superseded, or another PR's.
                    run(
                        6074,
                        "2026-10-19T18:21:00Z",
                        text("lane-stale.json"),
                        "cancelled"
                    ),
                    run(6111, "2026-10-19T18:21:00Z", text("lane-stale.json")),
                ],
            })
        );
        const cause = (pr: number, at: string) =>
            eps.find((e) => e.pr === pr && e.at === at)?.cause;
        expect(cause(6034, "2026-10-19T13:08:29Z")).toBe("environment");
        expect(cause(6074, "2026-10-19T18:21:25Z")).toBe("defect");
        expect(cause(6034, "2026-10-20T08:16:26Z")).toBe("stale-artefact");
    });

    it("rates failures over every landing attempt, every cause a row", () => {
        const t = weeklyTrends(facts());
        expect(t.throughput.merged).toBe(6);
        expect(t.landings).toMatchObject({ episodes: 7, attempts: 13 });
        expect(t.landings.rate).toBeCloseTo(7 / 13);
        expect(Object.keys(t.landings.byCause)).toEqual([...LANDING_CAUSES]);
        expect(t.landings.byCause).toMatchObject({
            rebase: 1,
            "red-base": 1,
            defect: 2,
            "red-lane": 3,
            other: 0,
        });
    });
});

describe("laneRecord — one queue-lane run's lane.json", () => {
    it("reads the verdict and the flakes", () => {
        expect(laneRecord(text("lane-flaky.json"))).toEqual({
            lane: "green",
            flakes: [
                {
                    files: ["scripts/__tests__/duplicate-test-blocks.test.ts"],
                    cause: "timeout",
                },
            ],
        });
        expect(laneRecord(text("lane-stale.json")).lane).toBe("regenerable");
        expect(laneRecord(text("lane-red.json")).lane).toBe("red");
        expect(laneRecord("").lane).toBe("refused");
        expect(laneRecord('{"ok": fal').lane).toBe("refused");
        expect(laneRecord(null).lane).toBe("unknown");
    });
});

describe("redEpisodes — time to green against the target", () => {
    it("opens on a RED, joins later REDs and AMBERs, closes on the next GREEN", () => {
        const eps = redEpisodes(facts());
        expect(
            eps.map((e) => [
                e.shas.map((s) => s.slice(0, 8)),
                e.redAt,
                e.greenAt,
                Number(e.hours.toFixed(2)),
                e.ownerFree,
            ])
        ).toEqual([
            // 1747f6cf (07:13, before the window) opened the episode
            // 8442d0b4 joined: it is not counted here.
            [
                ["51732781", "be13a424"],
                "2026-10-18T14:43:04Z",
                "2026-10-18T19:12:06Z",
                4.48,
                true,
            ],
            // The INFRA at e7f3581c decides nothing.
            [
                ["115730fc"],
                "2026-10-19T16:46:29Z",
                "2026-10-19T20:53:41Z",
                4.12,
                true,
            ],
            // The ladder stopped on it: the owner's.
            [
                ["4db4ed91"],
                "2026-10-20T08:14:41Z",
                "2026-10-20T08:48:27Z",
                0.56,
                false,
            ],
        ]);
        expect(redSummary(eps)).toMatchObject({
            episodes: 3,
            standing: 0,
            meetsOwnerFree: false,
            meetsP90: true,
        });
        expect(redSummary(eps).ownerFreePct).toBeCloseTo(200 / 3);
    });

    it("a RED still standing runs to the window's end and closes no target", () => {
        const eps = redEpisodes(
            facts({ window: { from: WINDOW.from, to: "2026-10-20T08:30:00Z" } })
        );
        const last = eps[eps.length - 1];
        expect(last).toMatchObject({ greenAt: null, ownerFree: false });
        expect(last.hours).toBeCloseTo(0.255, 2);
        expect(redSummary(eps).standing).toBe(1);
    });
});

describe("flakyRows — the queue's re-run and health's fresh run", () => {
    it("counts each subject per source, most frequent first", () => {
        const flaky = text("lane-flaky.json");
        const rows = flakyRows(
            facts({
                queueRuns: [
                    run(6111, "2026-10-20T09:51:22Z", flaky, "success"),
                    run(6112, "2026-10-20T10:01:17Z", flaky, "success"),
                    // Outside the window.
                    run(6000, "2026-10-17T10:00:00Z", flaky, "success"),
                ],
            })
        );
        expect(rows).toEqual([
            {
                subject: "scripts/__tests__/duplicate-test-blocks.test.ts",
                source: "queue-lane",
                count: 2,
                causes: ["timeout"],
            },
            // e675cca5's GREEN: `flake: test passed on a fresh run`.
            { subject: "test", source: "health", count: 1, causes: [] },
        ]);
    });
});

describe("cost and latency", () => {
    it("sums a pass's cost per issue, inside the window only", () => {
        expect(passCost(facts())).toEqual({
            passes: 3,
            issues: 2,
            totalUsd: 6.75,
            perIssueUsd: { n: 2, median: 2.25, p90: 4.5 },
            unknownCost: 1,
            recordsMissing: 0,
        });
        expect(passLatency(facts())).toEqual({
            minutes: { n: 3, median: 70, p90: 180 },
            byOutcome: { "handed-off": 2, timeout: 1 },
        });
    });

    it("times the queue from the last `ready-to-land` before the merge", () => {
        const q = queueHours(facts());
        expect(q.n).toBe(6);
        // PR #6120: ready 09:12:35, merged 09:20:28.
        expect(q.median).toBeCloseTo(0.46, 2);
        expect(q.p90).toBeCloseTo(1.27, 2);
    });

    it("reads a machine's budget and latency, or names why it has none", () => {
        const mac = parseMachineReading(text("machine-macbook.json"));
        const hua = parseMachineReading(text("machine-huawei.json"));
        expect(mac && machineTrend(mac)).toEqual({
            host: "filippos-macbook-pro",
            issues: 3,
            issueUsd: { n: 3, median: 3.1, p90: 7.9 },
            issueSharePct: { n: 3, median: 0.38, p90: 0.91 },
            sessions: 4,
            sessionWallMin: { median: 45, p90: 100 },
            errors: [],
        });
        expect(hua && machineTrend(hua)).toMatchObject({
            issues: null,
            sessionWallMin: null,
            errors: [
                "No LLM rows between 2026-10-14 and 2026-10-20.",
                "No main-thread turns between 2026-10-14 and 2026-10-20.",
            ],
        });
        expect(parseMachineReading("not json")).toBeNull();
    });

    it("percentile is nearest-rank", () => {
        expect(percentile([], 50)).toBeNull();
        expect(percentile([3, 1, 2], 50)).toBe(2);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    });
});

describe("summaryMarkdown — the job summary", () => {
    const machines = ["machine-macbook.json", "machine-huawei.json"].map(
        (n) => parseMachineReading(text(n))!
    );
    const md = summaryMarkdown(weeklyTrends(facts({ machines })));

    it("carries every section", () => {
        for (const heading of [
            "### Throughput",
            "### Failed landings by cause",
            "### RED episodes and time to green",
            "### Flaky tests",
            "### Cost per issue",
            "### Pass and queue latency",
            "### Machines",
        ])
            expect(md).toContain(heading);
        expect(md).toContain("PRs merged: 6 (0.13 per hour over 48 h)");
        expect(md).toContain(
            "closed without the owner: 67 % — target ≥ 80 % ❌"
        );
        expect(md).toContain("| rebase conflict | 1 |");
    });

    it("names no machine: the job summary is public", () => {
        expect(md).not.toMatch(/macbook|omarchy/i);
        expect(md).toContain("| machine 1 |");
    });
});
