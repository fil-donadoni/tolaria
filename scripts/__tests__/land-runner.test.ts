/**
 * The land-runner's decisions (issue #5469): which `ready-to-land` PR lands
 * next, what a `land` exit means for the PR's labels, what the failure
 * comment carries, and which machine runs it. All pure — `land-runner.ts`
 * is the I/O.
 */
import { describe, expect, it } from "vitest";
import {
    describeLandFailures,
    EXCERPT_LINES,
    failureReason,
    FAILED_LABEL,
    failureComment,
    labelArgs,
    landExcerpt,
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
    it("ready adds ready-to-land and drops land-failed (a repair re-queues with one verb)", () => {
        expect(labelArgs.ready(5)).toEqual([
            "pr",
            "edit",
            "5",
            "--add-label",
            READY_LABEL,
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

    it("failureReason takes the first error line, else the last line", () => {
        expect(failureReason(`land: refusing x\n…\nlane: ran\n${NODE}`)).toBe(
            "land: refusing x"
        );
        expect(failureReason("step one\nstep two\n")).toBe("step two");
        expect(failureReason(`\u001b[31m${NODE}\u001b[0m`)).toBe(NODE);
        expect(failureReason("")).toBe("no output");
    });
});
