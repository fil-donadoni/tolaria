/**
 * The land-runner's decisions (issue #5469): which `ready-to-land` PR lands
 * next, what a `land` exit means for the PR's labels, what the failure
 * comment carries, and which machine runs it. All pure — `land-runner.ts`
 * is the I/O — save the stop between two ticks, which a real signal proves.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    betweenTicks,
    checkSources,
    describeLandFailures,
    EXCERPT_LINES,
    failureReason,
    FAILED_LABEL,
    failureComment,
    INFRA_BACKOFF_S,
    INFRA_MAX_STRIKES,
    bodyWithClosingRef,
    handsToQueue,
    labelArgs,
    landExcerpt,
    launchdSupervised,
    LAUNCHD_LABEL,
    laneReceipt,
    mergedComment,
    outcomeOf,
    owesPresetSeed,
    parseLandRunnerConfig,
    planTick,
    READY_LABEL,
    runsHere,
    SATURATED_EXIT,
    SHADOW_LABEL,
    worktreeOfBranch,
    type LandFailure,
    type QueuedPr,
} from "../lib/land-runner";

const pr = (
    number: number,
    createdAt: string,
    over: Partial<QueuedPr> = {}
): QueuedPr => ({
    number,
    state: "OPEN",
    headRefName: `feat/issue-${number}`,
    createdAt,
    body: "",
    labels: [{ name: READY_LABEL }],
    ...over,
});

const branchesOf = (prs: QueuedPr[]) => new Set(prs.map((p) => p.headRefName));

describe("planTick — the oldest ready-to-land PR lands first", () => {
    it("picks by creation time, not by PR number or list order", () => {
        const prs = [
            pr(30, "2026-10-12T10:00:00Z"),
            pr(40, "2026-10-12T09:00:00Z"),
            pr(20, "2026-10-12T11:00:00Z"),
        ];
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: false,
            repairIssues: [],
        });
        expect(plan.next?.number).toBe(40);
        expect(plan.stale).toEqual([]);
        expect(plan.held).toEqual([]);
    });

    it("breaks a creation-time tie by PR number", () => {
        const prs = [
            pr(9, "2026-10-12T10:00:00Z"),
            pr(8, "2026-10-12T10:00:00Z"),
        ];
        expect(
            planTick(prs, {
                remoteBranches: branchesOf(prs),
                red: false,
                repairIssues: [],
            }).next?.number
        ).toBe(8);
    });

    it("an empty queue lands nothing", () => {
        expect(
            planTick([], {
                remoteBranches: new Set(),
                red: false,
                repairIssues: [],
            })
        ).toEqual({ shadowed: [], stale: [], held: [], next: null });
    });
});

describe("planTick — a stale ready-to-land PR is unlabelled, never landed", () => {
    it("a closed or merged PR is stale", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", { state: "CLOSED" }),
            pr(2, "2026-10-12T08:30:00Z", { state: "MERGED" }),
            pr(3, "2026-10-12T09:00:00Z"),
        ];
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: false,
            repairIssues: [],
        });
        expect(plan.stale.map((s) => s.pr)).toEqual([1, 2]);
        expect(plan.stale[0].reason).toMatch(/closed/);
        expect(plan.stale[1].reason).toMatch(/merged/);
        expect(plan.next?.number).toBe(3);
    });

    it("an open PR whose branch is gone from origin is stale", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z"),
            pr(2, "2026-10-12T09:00:00Z"),
        ];
        const plan = planTick(prs, {
            remoteBranches: new Set(["feat/issue-2"]),
            red: false,
            repairIssues: [],
        });
        expect(plan.stale).toEqual([
            { pr: 1, reason: "branch feat/issue-1 is gone from origin" },
        ]);
        expect(plan.next?.number).toBe(2);
    });
});

describe("planTick — a queue:shadow PR is Mergify's, never touched (issue #5642)", () => {
    const shadow = { labels: [{ name: READY_LABEL }, { name: SHADOW_LABEL }] };

    it("is never landed, even when it is the oldest", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", shadow),
            pr(2, "2026-10-12T09:00:00Z"),
        ];
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: false,
            repairIssues: [],
        });
        expect(plan.next?.number).toBe(2);
        expect(plan.shadowed.map((s) => s.pr)).toEqual([1]);
    });

    it("is never unlabelled — merged by the queue, closed, or branch gone", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", { ...shadow, state: "MERGED" }),
            pr(2, "2026-10-12T08:30:00Z", { ...shadow, state: "CLOSED" }),
            pr(3, "2026-10-12T09:00:00Z", shadow),
        ];
        const plan = planTick(prs, {
            remoteBranches: new Set<string>(),
            red: true,
            repairIssues: [],
        });
        expect(plan).toEqual({
            shadowed: [1, 2, 3].map((n) => ({
                pr: n,
                reason: `labelled \`${SHADOW_LABEL}\` — the Mergify queue lands it`,
            })),
            stale: [],
            held: [],
            next: null,
        });
    });
});

describe("planTick — under RED only a declared repair lands (AMBER resumes the rest)", () => {
    const prs = [
        pr(1, "2026-10-12T08:00:00Z", { body: "Closes #500" }),
        pr(2, "2026-10-12T09:00:00Z", { body: "Closes #777" }),
    ];

    it("holds a PR closing no recorded repair issue and lands the repair", () => {
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: true,
            repairIssues: [777],
        });
        expect(plan.held.map((h) => h.pr)).toEqual([1]);
        expect(plan.held[0].reason).toMatch(/RED/);
        expect(plan.next?.number).toBe(2);
    });

    it("holds everything when no repair is queued — nothing lands, nothing is failed", () => {
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: true,
            repairIssues: [],
        });
        expect(plan.held.map((h) => h.pr)).toEqual([1, 2]);
        expect(plan.next).toBeNull();
    });

    it("off RED (GREEN or AMBER) the held PR lands in its turn", () => {
        const plan = planTick(prs, {
            remoteBranches: branchesOf(prs),
            red: false,
            repairIssues: [777],
        });
        expect(plan.held).toEqual([]);
        expect(plan.next?.number).toBe(1);
    });
});

describe("planTick — a row is read by its own labels, never by the list's filter (issue #5941)", () => {
    // The search index lists a PR for seconds after `ready-to-land` left it;
    // the row's own `labels` are already fresh (PR #5945, 2026-10-18).
    const failed = {
        labels: [{ name: FAILED_LABEL }, { name: "area:workflow" }],
    };
    const ctx = (prs: QueuedPr[]) => ({
        remoteBranches: branchesOf(prs),
        red: false,
        repairIssues: [],
    });

    it("holds a row the index still lists after its land-failed relabel, and lands the next", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", failed),
            pr(2, "2026-10-12T09:00:00Z"),
        ];
        const plan = planTick(prs, ctx(prs));
        expect(plan.held.map((h) => h.pr)).toEqual([1]);
        expect(plan.held[0].reason).toMatch(/search index/);
        expect(plan.stale).toEqual([]);
        expect(plan.next?.number).toBe(2);
    });

    it("holds a row carrying both labels — land-failed wins", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", {
                labels: [{ name: READY_LABEL }, { name: FAILED_LABEL }],
            }),
        ];
        const plan = planTick(prs, ctx(prs));
        expect(plan.held.map((h) => h.pr)).toEqual([1]);
        expect(plan.next).toBeNull();
    });

    it("never unlabels a closed row that lost its label — nothing to undo", () => {
        const prs = [
            pr(1, "2026-10-12T08:00:00Z", { ...failed, state: "CLOSED" }),
        ];
        const plan = planTick(prs, ctx(prs));
        expect(plan.stale).toEqual([]);
        expect(plan.held.map((h) => h.pr)).toEqual([1]);
    });
});

describe("checkSources — a merged runner change restarts the runner (issue #5941)", () => {
    it("restarts under launchd when the committed sources moved since start", () => {
        expect(checkSources("tree-a\nconf-a", "tree-b\nconf-a", true)).toBe(
            "restart"
        );
    });

    it("only warns when nothing would bring the runner back", () => {
        expect(checkSources("tree-a\nconf-a", "tree-b\nconf-a", false)).toBe(
            "warn"
        );
    });

    it("carries on while they stand still", () => {
        expect(checkSources("tree-a\nconf-a", "tree-a\nconf-a", true)).toBe(
            "same"
        );
    });

    it("never restarts on an unreadable reading — a broken checkout would loop", () => {
        expect(checkSources("tree-a", null, true)).toBe("unreadable");
        expect(checkSources(null, "tree-b", true)).toBe("same");
    });
});

// The runner's loop in miniature: back-to-back ticks, each blocking on
// `spawnSync` like a `land` does, then `betweenTicks` — under bun, as the
// runner runs. Prints `tick N` as each landing starts, `ticks=N` at the end.
const BUSY_LOOP = `
import { spawnSync } from "node:child_process";
import { betweenTicks } from ${JSON.stringify(join(import.meta.dirname, "../lib/land-runner.ts"))};
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
let ticks = 0;
do {
    ticks++;
    console.log("tick " + ticks);
    spawnSync("sleep", ["0.3"]);
    if (stopping || ticks === 6) break;
    await betweenTicks(true, 60, () => stopping, Bun.sleep);
} while (!stopping);
console.log("ticks=" + ticks);
`;

describe("betweenTicks — a stop is served between two landings (issue #5950)", () => {
    it("ends a busy queue's loop after the landing in flight", async () => {
        const child = spawn("bun", ["-e", BUSY_LOOP], {
            stdio: ["ignore", "pipe", "inherit"],
        });
        let out = "";
        let signalled = false;
        child.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            if (!signalled && out.includes("tick 1")) {
                signalled = true;
                child.kill("SIGTERM");
            }
        });
        const code = await new Promise<number | null>((done) =>
            child.on("close", done)
        );
        expect(code).toBe(0);
        expect(out).toContain("ticks=1");
    }, 15_000);

    it("returns at once after a landing, waits the interval on a quiet queue", async () => {
        const slept: number[] = [];
        const sleep = async (ms: number) => void slept.push(ms);
        await betweenTicks(true, 3, () => false, sleep);
        expect(slept).toEqual([0]);
        slept.length = 0;
        await betweenTicks(false, 3, () => false, sleep);
        expect(slept).toEqual([0, 1000, 1000, 1000]);
        slept.length = 0;
        await betweenTicks(false, 3, () => true, sleep);
        expect(slept).toEqual([0]);
    });
});

describe("launchdSupervised — only launchd's own job exits for a restart (issue #5941)", () => {
    it("is the job launchd names in XPC_SERVICE_NAME", () => {
        expect(launchdSupervised({ XPC_SERVICE_NAME: LAUNCHD_LABEL })).toBe(
            true
        );
    });

    it("is not loop:afk's detached start, nor another launchd job", () => {
        expect(launchdSupervised({})).toBe(false);
        expect(
            launchdSupervised({
                XPC_SERVICE_NAME: "application.com.apple.Terminal",
            })
        ).toBe(false);
    });
});

describe("outcomeOf — a land exit read as a label decision", () => {
    it("0 merged", () => {
        expect(outcomeOf(0, "lane: ran")).toEqual({ action: "merged" });
    });

    it("77 (machine saturated, nothing ran) and a signal stay queued — never land-failed", () => {
        expect(outcomeOf(SATURATED_EXIT, "").action).toBe("requeue");
        expect(outcomeOf(null, "").action).toBe("requeue");
    });

    it("any other exit is a red landing carrying the excerpt", () => {
        const o = outcomeOf(
            1,
            "lane: ran\n  ✗ check:ts  3.0s\nFAIL  9.0s total\n"
        );
        expect(o.action).toBe("failed");
        if (o.action === "failed")
            expect(o.excerpt).toMatch(/FAIL {2}9\.0s total/);
    });
});

// Issue #5955: a red landing is classified before it is labelled.
describe("outcomeOf — a classified red (issue #5955)", () => {
    const BLADE = "scripts/__tests__/blade-card-index-drift.bot.test.ts";
    const log = "lane: ran\n  ✗ check:pr  398.3s\nFAIL  398.3s total\n";

    it("a regenerable lane red is a fixup, never land-failed", () => {
        expect(
            outcomeOf(1, log, {
                lane: {
                    ok: false,
                    outcomes: [
                        {
                            id: "vitest(bot)",
                            status: "fail",
                            failedFiles: [BLADE],
                        },
                    ],
                },
                subjects: ["fix: x"],
            })
        ).toEqual({ action: "fixup", fixes: ["blade-index"] });
    });

    it("an outage outside the lane re-queues behind the infra backoff", () => {
        const o = outcomeOf(
            1,
            "lane: skipped (gated a against b)\nHTTP 502: Bad Gateway (https://api.github.com/graphql)\n",
            { lane: null, subjects: [] }
        );
        expect(o.action).toBe("requeue");
        if (o.action === "requeue") {
            expect(o.backoffS).toBe(INFRA_BACKOFF_S);
            expect(o.reason).toMatch(/^infra — HTTP 502/);
        }
    });

    it("the N-th consecutive infra red is land-failed after all — never an endless re-queue", () => {
        const outage =
            "lane: skipped (gated a against b)\nHTTP 502: Bad Gateway (https://api.github.com/graphql)\n";
        expect(
            outcomeOf(1, outage, {
                lane: null,
                subjects: [],
                infraStrikes: INFRA_MAX_STRIKES - 2,
            }).action
        ).toBe("requeue");
        const o = outcomeOf(1, outage, {
            lane: null,
            subjects: [],
            infraStrikes: INFRA_MAX_STRIKES - 1,
        });
        expect(o.action).toBe("failed");
        if (o.action === "failed")
            expect(o.cause).toMatch(/^infra 3 times running/);
    });

    it("everything else is land-failed, carrying the class's reason", () => {
        const o = outcomeOf(1, log, {
            lane: {
                ok: false,
                outcomes: [
                    {
                        id: "check:pr",
                        status: "fail",
                        failedFiles: ["a.test.ts"],
                    },
                ],
            },
            subjects: [],
        });
        expect(o.action).toBe("failed");
        if (o.action === "failed") {
            expect(o.cause).toBe(
                "lane step check:pr (a.test.ts) failed with no fixup row"
            );
            expect(o.excerpt).toMatch(/FAIL {2}398\.3s total/);
        }
    });
});

describe("planTick — an infra red's PR waits out its backoff (issue #5955)", () => {
    const prs = [
        pr(10, "2026-10-18T10:00:00Z"),
        pr(11, "2026-10-18T10:01:00Z"),
    ];
    const ctx = {
        remoteBranches: branchesOf(prs),
        red: false,
        repairIssues: [],
    };

    it("holds the deferred PR and lands the next while the backoff stands", () => {
        const plan = planTick(prs, {
            ...ctx,
            deferred: new Map([[10, { until: 2_000, strikes: 1 }]]),
            now: 1_000,
        });
        expect(plan.next?.number).toBe(11);
        expect(plan.held.map((h) => h.pr)).toEqual([10]);
        expect(plan.held[0].reason).toMatch(
            /infra red \(1\/3\) — retried after/
        );
    });

    it("lands it once the backoff has passed", () => {
        const plan = planTick(prs, {
            ...ctx,
            deferred: new Map([[10, { until: 2_000, strikes: 1 }]]),
            now: 2_000,
        });
        expect(plan.next?.number).toBe(10);
        expect(plan.held).toEqual([]);
    });
});

describe("landExcerpt — the lines a repairer needs", () => {
    it("keeps the last EXCERPT_LINES lines, ANSI stripped", () => {
        const out = Array.from(
            { length: 200 },
            (_, i) => `\u001b[31mline ${i}\u001b[0m`
        ).join("\n");
        const ex = landExcerpt(out).split("\n");
        expect(ex).toHaveLength(EXCERPT_LINES);
        expect(ex.at(-1)).toBe("line 199");
        expect(ex.join("\n")).not.toContain("\u001b");
    });

    it("prepends a refusal line that scrolled out of the tail", () => {
        const out = [
            "land: refusing — PR body has no `## Preset scenario` section",
            ...Array.from({ length: 100 }, (_, i) => `noise ${i}`),
        ].join("\n");
        const ex = landExcerpt(out).split("\n");
        expect(ex[0]).toMatch(/^land: refusing/);
        expect(ex[1]).toBe("…");
    });
});

describe("the PR comments", () => {
    it("the failure comment names the exit, the next step and fences the excerpt", () => {
        const body = failureComment({
            status: 1,
            excerpt: "```\nweird ``` fence",
            logPath: "/x/land-9.log",
        });
        expect(body).toMatch(/exited 1/);
        expect(body).toMatch(new RegExp(FAILED_LABEL));
        expect(body).toMatch(/land:ready/);
        expect(body).toMatch(/\/x\/land-9\.log/);
        // The fence is longer than any backtick run inside the excerpt.
        expect(body).toMatch(/^````$/m);
    });

    it("names the class when the runner classified the red (issue #5955)", () => {
        const body = failureComment({
            status: 1,
            excerpt: "x",
            logPath: "/l",
            cause: "lane step tsc[all] failed with no fixup row",
        });
        expect(body).toMatch(
            /Class: `needs-pass` — lane step tsc\[all\] failed with no fixup row\./
        );
    });

    it("a branch naming no issue (a docs lane) says no pass is handed it", () => {
        const body = failureComment({
            status: 1,
            excerpt: "x",
            logPath: "/l",
            repairable: false,
        });
        expect(body).toMatch(/names no issue/);
        expect(body).not.toMatch(/repair pick/);
    });

    it("the merged comment carries land's lane receipt (ADR 0136 §2)", () => {
        expect(laneReceipt("…\nlane: skipped (gated abc against def)\n…")).toBe(
            "lane: skipped (gated abc against def)"
        );
        expect(laneReceipt("no receipt")).toBeNull();
        expect(mergedComment("\u001b[2mlane: ran\u001b[0m")).toMatch(
            /`lane: ran`/
        );
    });
});

describe("label moves", () => {
    it("ready to the runner adds ready-to-land, drops land-failed and any queue:shadow (a repair re-queues with one verb; no PR is left with no merger, issue #5952)", () => {
        expect(labelArgs.ready(5, { shadow: false })).toEqual([
            "pr",
            "edit",
            "5",
            "--add-label",
            READY_LABEL,
            "--remove-label",
            FAILED_LABEL,
            "--remove-label",
            SHADOW_LABEL,
        ]);
    });

    it("ready to the queue adds ready-to-land and queue:shadow, drops land-failed (issue #5952)", () => {
        expect(labelArgs.ready(5, { shadow: true })).toEqual([
            "pr",
            "edit",
            "5",
            "--add-label",
            READY_LABEL,
            "--add-label",
            SHADOW_LABEL,
            "--remove-label",
            FAILED_LABEL,
        ]);
    });

    it("failed swaps ready-to-land for land-failed; unqueue only drops ready-to-land", () => {
        expect(labelArgs.failed(5)).toEqual([
            "pr",
            "edit",
            "5",
            "--remove-label",
            READY_LABEL,
            "--add-label",
            FAILED_LABEL,
        ]);
        expect(labelArgs.unqueue(5)).toEqual([
            "pr",
            "edit",
            "5",
            "--remove-label",
            READY_LABEL,
        ]);
    });
});

describe("handsToQueue — who lands a handed-off PR (issue #5952)", () => {
    it("the queue, when pr-gate's trusted-author verdict is green", () => {
        expect(handsToQueue({ trustedAuthor: "success" })).toBe(true);
    });

    it("the runner, when the queue would refuse it — never a shadow PR with no merger", () => {
        expect(handsToQueue({ trustedAuthor: "failure" })).toBe(false);
        expect(handsToQueue({ trustedAuthor: "pending" })).toBe(false);
    });
});

describe("bodyWithClosingRef — GitHub closes the issue at merge, whoever merges (issue #5952)", () => {
    it("appends a bare Closes #N when GitHub links no closing ref to the issue", () => {
        expect(bodyWithClosingRef("Summary.\n\n", 12, [])).toBe(
            "Summary.\n\nCloses #12\n"
        );
        // Another issue's closing ref is not this one's.
        expect(bodyWithClosingRef("Fixes #7", 12, [7])).toBe(
            "Fixes #7\n\nCloses #12\n"
        );
    });

    it("leaves a body GitHub already links as closing the issue", () => {
        expect(bodyWithClosingRef("Closes #12", 12, [12])).toBeNull();
    });
});

describe("worktreeOfBranch — land from the session's own worktree when it still exists", () => {
    const porcelain = [
        "worktree /repo",
        "HEAD aaa",
        "branch refs/heads/staging",
        "",
        "worktree /repo-issue-12",
        "HEAD bbb",
        "branch refs/heads/feat/issue-12",
        "",
        "worktree /repo-detached",
        "HEAD ccc",
        "detached",
        "",
    ].join("\n");

    it("finds the worktree holding the branch", () => {
        expect(worktreeOfBranch(porcelain, "feat/issue-12")).toBe(
            "/repo-issue-12"
        );
    });

    it("null when no worktree holds it — a prefix is not a match", () => {
        expect(worktreeOfBranch(porcelain, "feat/issue-1")).toBeNull();
    });
});

describe("which machine runs it — the MacBook, never the Huawei (topology B')", () => {
    it("defaults to darwin and a 60 s tick", () => {
        expect(parseLandRunnerConfig({})).toEqual({
            platform: "darwin",
            intervalS: 60,
        });
    });

    it("reads the config block, rejecting a non-positive interval", () => {
        expect(
            parseLandRunnerConfig({
                landRunner: { platform: "linux", intervalS: 5 },
            })
        ).toEqual({ platform: "linux", intervalS: 5 });
        expect(
            parseLandRunnerConfig({ landRunner: { intervalS: 0 } }).intervalS
        ).toBe(60);
    });

    it("runs on the configured platform only", () => {
        const config = parseLandRunnerConfig({
            landRunner: { platform: "darwin" },
        });
        expect(runsHere(config, "darwin")).toBe(true);
        expect(runsHere(config, "linux")).toBe(false);
    });
});

describe("owesPresetSeed — the post-merge seed a session used to run", () => {
    it("is owed by a card-set diff only", () => {
        expect(owesPresetSeed(["convex/cards/sets/lea/blue.ts"])).toBe(true);
        expect(owesPresetSeed(["convex/gre/sba.ts", "scripts/x.ts"])).toBe(
            false
        );
    });
});

describe("owner notification for land-failed (issue #5599)", () => {
    const f = (prNo: number, reason: string): LandFailure => ({
        pr: prNo,
        reason,
        logPath: `/log/land-${prNo}.log`,
    });
    const NODE = "env: node: No such file or directory";

    it("no failure → no notification", () => {
        expect(describeLandFailures([])).toBeNull();
    });

    it("one failure names PR, reason and log path", () => {
        const m = describeLandFailures([f(5570, "lane: tsc red")])!;
        expect(m).toContain("PR #5570");
        expect(m).toContain("lane: tsc red");
        expect(m).toContain("/log/land-5570.log");
        expect(m).not.toContain("likely infra");
    });

    it("the same reason on N PRs coalesces into one machine-level message", () => {
        const m = describeLandFailures([
            f(5570, NODE),
            f(5581, NODE),
            f(5582, NODE),
        ])!;
        expect(m.startsWith("3 PRs land-failed")).toBe(true);
        expect(m.split(NODE)).toHaveLength(2);
        expect(m).toContain("same cause on 3 PRs — likely infra, not the PRs");
        expect(m).toContain("#5570, #5581, #5582");
    });

    it("distinct reasons stay separate clauses in the same message", () => {
        const m = describeLandFailures([f(1, "a red"), f(2, "b red")])!;
        expect(m).toContain("#1: a red");
        expect(m).toContain("#2: b red");
        expect(m).not.toContain("likely infra");
    });

    it("a second consecutive failure with the same reason is machine-level", () => {
        const m = describeLandFailures([f(7, NODE)], NODE)!;
        expect(m).toContain("same cause as the previous failure");
        expect(describeLandFailures([f(7, NODE)], "other")).not.toContain(
            "likely infra"
        );
    });

    it("failureReason names the ✗ step and its error, never a skip line (PR #5932, issue #6000)", () => {
        // The tail of PR #5932's land log, 2026-10-19: the plan's skip
        // reasons say "cannot drift", and the old picker quoted one.
        const log = [
            "lane: ran",
            "$ bun scripts/check-lane.ts",
            "lane:  engine   (HEAD e108f9662, 16 files — 15 under convex/**)",
            "run:   format(diff) lint(diff) tsc[all] check:index",
            "skip:  dom            — no changed code under src/** — the whole type-check is the backstop (#2738)",
            "       bundle         — health-only (ADR 0154 §3): check:bundle costs 12–24 s",
            "       blade-index    — no changed path under convex/gre/ai/blade/** — the blade card index cannot drift",
            "       predicate: classifyPath() in scripts/check-lane.ts",
            "Checking formatting...",
            "All matched files use Prettier code style!",
            "$ tsc -b --noEmit",
            "scripts/lib/vitest-reporters.ts(10,29): error TS2307: Cannot find module '@mergifyio/vitest' or its corresponding type declarations.",
            "  ✓ format(diff)         1.0s",
            "  ✓ lint(diff)           1.6s",
            "  \u001b[31m✗\u001b[0m tsc[all]             76.8s",
            "  · check:index        ",
            "",
            "tree:  e108f9662 → e108f9662   (start → end)",
            "FAIL  79.4s total",
            'error: script "check:lane" exited with code 1',
        ].join("\n");
        expect(failureReason(log)).toBe(
            "✗ tsc[all] — scripts/lib/vitest-reporters.ts(10,29): error TS2307: Cannot find module '@mergifyio/vitest' or its corresponding type declarations."
        );
    });

    it("failureReason skips passing tests and vitest rules for the cause", () => {
        const log = [
            "     ✓ leaves no green record for a red gate  1328ms",
            "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
            " FAIL   node-tooling  scripts/__tests__/health-ui-walk.test.ts > is the LAST health step",
            "  ✓ tsc[all]             0.2s",
            "  ✗ node-tooling         118.5s",
        ].join("\n");
        expect(failureReason(log)).toBe(
            "✗ node-tooling — FAIL   node-tooling  scripts/__tests__/health-ui-walk.test.ts > is the LAST health step"
        );
    });

    it("failureReason takes the first error line, else the last line", () => {
        expect(failureReason(`land: refusing x\n…\nlane: ran\n${NODE}`)).toBe(
            "land: refusing x"
        );
        expect(failureReason("step one\nstep two\n")).toBe("step two");
        expect(failureReason(`\u001b[31m${NODE}\u001b[0m`)).toBe(NODE);
        expect(failureReason("")).toBe("no output");
    });
});
