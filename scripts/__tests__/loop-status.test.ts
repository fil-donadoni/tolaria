import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    buildLoopStatus,
    computeStage,
    queueDepthByPriority,
    approvedReviewIssues,
    worktreeIssueNumbers,
    parseDriverPassLine,
    readRecentPasses,
    readDriverState,
    renderLoopStatusText,
    summarizeReceipts,
    INTERESTING_RECEIPTS_CAP,
    type LoopStatusInput,
    type DriverState,
} from "../lib/loop-status";
import { type ClaimedIssue } from "../loop-doctor";
import type { Receipt } from "../lib/receipt";

/**
 * `loop:status` (#2519) — the aggregation `bun run loop:status` and the
 * dashboard's `/api/loop-status` route both call. Every test here drives
 * `buildLoopStatus` (and its helpers) with hand-built fixtures; nothing
 * shells out to `gh` or `git` — that I/O lives only in the CLI wrapper and
 * the server route, neither of which this file touches.
 */

const EMPTY_DRIVER: DriverState = {
    armed: false,
    pid: null,
    pidAlive: false,
    stopFilePresent: false,
    recentPasses: [],
};

function issue(
    number: number,
    updatedAt: string,
    title = `issue ${number}`
): ClaimedIssue {
    return { number, title, updatedAt };
}

function baseInput(overrides: Partial<LoopStatusInput> = {}): LoopStatusInput {
    return {
        claimedIssues: [],
        prBranches: new Set(),
        allBranches: [],
        worktreeIssueNumbers: new Set(),
        approvedReviewIssues: new Set(),
        priority: {},
        readyQueueIssues: [],
        receipts: [],
        driver: EMPTY_DRIVER,
        now: new Date("2026-08-18T12:00:00Z").getTime(),
        ...overrides,
    };
}

describe("loop-status — computeStage", () => {
    it("is 'claimed' with none of the downstream facts", () => {
        expect(
            computeStage({
                hasWorktree: false,
                hasBranch: false,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("claimed");
    });

    it("advances to 'worktree' once a worktree exists, before any branch is pushed", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasBranch: false,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("worktree");
    });

    it("advances to 'branch pushed' — a worktree fact does not regress the stage", () => {
        expect(
            computeStage({
                hasWorktree: false,
                hasBranch: true,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("branch pushed");
    });

    it("advances to 'PR open' once a PR exists", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasBranch: true,
                hasOpenPr: true,
                reviewApproved: false,
            })
        ).toBe("PR open");
    });

    it("only reaches 'merging' once a review has approved the open PR", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasBranch: true,
                hasOpenPr: true,
                reviewApproved: true,
            })
        ).toBe("merging");
    });

    it("does NOT call it 'merging' on an approved review with no open PR", () => {
        // A stale/superseded approval on a closed PR must not read as
        // "merging" — hasOpenPr is the gate, reviewApproved only refines it.
        expect(
            computeStage({
                hasWorktree: true,
                hasBranch: true,
                hasOpenPr: false,
                reviewApproved: true,
            })
        ).toBe("branch pushed");
    });
});

describe("loop-status — queueDepthByPriority", () => {
    it("buckets P0/P1/P2 and unprioritized separately, with an accurate total", () => {
        const depth = queueDepthByPriority(
            [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }],
            { 1: "P0", 2: "P1", 3: "P1" }
        );
        expect(depth).toEqual({
            P0: 1,
            P1: 2,
            P2: 0,
            unprioritized: 1,
            total: 4,
        });
    });

    it("does NOT fold an unprioritized issue into P2 — they are different facts", () => {
        const depth = queueDepthByPriority([{ number: 9 }], {});
        expect(depth.P2).toBe(0);
        expect(depth.unprioritized).toBe(1);
    });
});

describe("loop-status — worktreeIssueNumbers", () => {
    it("extracts the issue number from a <repo>-issue-N worktree path", () => {
        const set = worktreeIssueNumbers([
            { path: "/Users/x/code/mtg/tolaria-issue-2519" },
            { path: "/Users/x/code/mtg/tolaria" }, // the primary checkout itself
        ]);
        expect(set.has(2519)).toBe(true);
        expect(set.size).toBe(1);
    });

    it("does NOT match a path with extra text AFTER the issue number", () => {
        // A hand-renamed or backup worktree ("...-issue-2519-old") is not the
        // same thing as the live "...-issue-2519" worktree — the trailing
        // "-old" must make this a non-match, not a false positive on #2519.
        const set = worktreeIssueNumbers([
            { path: "/Users/x/code/mtg/tolaria-issue-2519-old" },
        ]);
        expect(set.has(2519)).toBe(false);
        expect(set.size).toBe(0);
    });
});

describe("loop-status — approvedReviewIssues", () => {
    const review = (
        issueNum: number,
        outcome: "approve" | "blocking",
        round?: number
    ): Receipt =>
        ({
            version: 1,
            role: "review",
            issue: issueNum,
            outcome,
            pr: 100 + issueNum,
            findings: outcome === "blocking" ? ["x"] : [],
            ...(round === undefined ? {} : { round }),
        }) as Receipt;

    it("counts an issue whose only review round approved", () => {
        expect(approvedReviewIssues([review(1, "approve")]).has(1)).toBe(true);
    });

    it("does NOT count an issue whose only review round was blocking", () => {
        expect(approvedReviewIssues([review(1, "blocking")]).has(1)).toBe(
            false
        );
    });

    it("uses the NEWEST round when a blocking round-1 is followed by an approving round-2", () => {
        const set = approvedReviewIssues([
            review(1, "blocking", 1),
            review(1, "approve", 2),
        ]);
        expect(set.has(1)).toBe(true);
    });

    it("uses the NEWEST round the other way too — approve then a later blocking round", () => {
        const set = approvedReviewIssues([
            review(1, "approve", 1),
            review(1, "blocking", 2),
        ]);
        expect(set.has(1)).toBe(false);
    });
});

describe("loop-status — parseDriverPassLine / readRecentPasses", () => {
    it("parses a well-formed loop-drain.log line", () => {
        const line = "1755000000 3 0 52.03 201 198 -";
        expect(parseDriverPassLine(line)).toEqual({
            epoch: 1755000000,
            pass: 3,
            claudeExit: 0,
            pct: "52.03",
            queueBefore: 201,
            queueAfter: 198,
            reason: "-",
        });
    });

    it("joins a multi-word reason back into one field", () => {
        const line = "1755000000 3 1 n/a 201 201 usage-error extra-words";
        expect(parseDriverPassLine(line)?.reason).toBe(
            "usage-error extra-words"
        );
    });

    it("drops a line that does not fit the shape, rather than throwing", () => {
        expect(parseDriverPassLine("garbage")).toBeNull();
    });

    it("reads the newest N lines from a real file, oldest-of-the-window first", () => {
        const tmp = fs.mkdtempSync(
            path.join(os.tmpdir(), "tolaria-loop-status-")
        );
        const logPath = path.join(tmp, "loop-drain.log");
        const lines = [1, 2, 3, 4].map(
            (n) => `${1755000000 + n} ${n} 0 10 5 5 -`
        );
        fs.writeFileSync(logPath, lines.join("\n") + "\n");
        const recent = readRecentPasses(logPath, 2);
        expect(recent.map((p) => p.pass)).toEqual([3, 4]);
    });

    it("returns an empty array when the log file does not exist", () => {
        expect(readRecentPasses("/nonexistent/loop-drain.log")).toEqual([]);
    });
});

describe("loop-status — readDriverState", () => {
    it("reports armed/pid/stop-file from real files under an explicit telemetryDir", () => {
        const tmp = fs.mkdtempSync(
            path.join(os.tmpdir(), "tolaria-loop-status-")
        );
        fs.writeFileSync(path.join(tmp, "afk.conf"), "CLAUDE_ARGS=\n");
        fs.writeFileSync(path.join(tmp, "loop-drain.pid"), "4242\n");
        fs.writeFileSync(path.join(tmp, "loop-stop"), "");

        const state = readDriverState({
            telemetryDir: tmp,
            isAlive: (pid) => pid === 4242,
        });
        expect(state.armed).toBe(true);
        expect(state.pid).toBe(4242);
        expect(state.pidAlive).toBe(true);
        expect(state.stopFilePresent).toBe(true);
    });

    it("reports a STALE pid file as not alive, distinctly from no pid file at all", () => {
        const tmp = fs.mkdtempSync(
            path.join(os.tmpdir(), "tolaria-loop-status-")
        );
        fs.writeFileSync(path.join(tmp, "loop-drain.pid"), "9999\n");

        const state = readDriverState({
            telemetryDir: tmp,
            isAlive: () => false,
        });
        expect(state.pid).toBe(9999);
        expect(state.pidAlive).toBe(false);
    });

    it("reports nothing armed/running/stopped when the directory is empty", () => {
        const tmp = fs.mkdtempSync(
            path.join(os.tmpdir(), "tolaria-loop-status-")
        );
        const state = readDriverState({ telemetryDir: tmp });
        expect(state).toEqual({
            armed: false,
            pid: null,
            pidAlive: false,
            stopFilePresent: false,
            recentPasses: [],
        });
    });
});

describe("loop-status — buildLoopStatus", () => {
    it("imports classifyClaim's verdict rather than deriving a second one — an orphan claim reads as orphan here too", () => {
        const status = buildLoopStatus(
            baseInput({
                claimedIssues: [
                    issue(1969, "2026-08-15T00:00:00Z", "old orphan"),
                ],
            })
        );
        expect(status.claims[0]!.verdict.state).toBe("orphan");
    });

    it("layers stage on top of the SAME verdict rather than forking it — a branch-pushed claim is 'live' AND 'branch pushed'", () => {
        const status = buildLoopStatus(
            baseInput({
                claimedIssues: [issue(42, "2026-08-18T11:30:00Z")],
                allBranches: ["feat/issue-42"],
            })
        );
        const row = status.claims[0]!;
        expect(row.verdict.state).toBe("live");
        expect(row.stage).toBe("branch pushed");
    });

    it("sorts claims by board priority first, oldest-first within a tier", () => {
        const status = buildLoopStatus(
            baseInput({
                claimedIssues: [
                    // #1 is NEWER than #2 but outranks it on priority — a
                    // pure age sort would put #2 first, proving priority is
                    // really the primary key rather than a coincidence of
                    // this fixture's ages.
                    issue(1, "2026-08-18T11:00:00Z", "P0, 1h old"),
                    issue(2, "2026-08-18T00:00:00Z", "P1, 12h old"),
                    issue(3, "2026-08-18T10:00:00Z", "P0, 2h old"),
                ],
                priority: { 1: "P0", 2: "P1", 3: "P0" },
            })
        );
        expect(status.claims.map((c) => c.issue)).toEqual([3, 1, 2]);
    });

    it("sorts an unprioritized claim after every explicitly prioritized one", () => {
        const status = buildLoopStatus(
            baseInput({
                claimedIssues: [
                    issue(1, "2026-08-18T11:00:00Z"),
                    issue(2, "2026-08-18T11:00:00Z"),
                ],
                priority: { 2: "P2" },
            })
        );
        expect(status.claims.map((c) => c.issue)).toEqual([2, 1]);
    });

    it("passes the queue depth through unchanged and summarizes the receipts (PR #2545 review, finding 3)", () => {
        const receipts: Receipt[] = [
            {
                version: 1,
                role: "implement",
                issue: 7,
                outcome: "pr-open",
                branch: "feat/issue-7",
                worktree: "/x",
                targetFiles: ["a.ts"],
                proofOfFailure: [],
                pr: 700,
            },
        ];
        const status = buildLoopStatus(
            baseInput({
                readyQueueIssues: [{ number: 1 }, { number: 2 }],
                priority: { 1: "P0" },
                receipts,
            })
        );
        expect(status.queueDepth).toEqual({
            P0: 1,
            P1: 0,
            P2: 0,
            unprioritized: 1,
            total: 2,
        });
        expect(status.receiptsSummary).toEqual({
            total: 1,
            counts: [{ role: "implement", outcome: "pr-open", count: 1 }],
            interesting: [],
        });
    });
});

describe("loop-status — summarizeReceipts", () => {
    const missing = (session: string): Receipt => ({
        version: 1,
        role: "missing",
        outcome: "missing",
        session,
        transcript: null,
        agentId: null,
        agentType: null,
        agentTranscript: null,
    });

    const work = (over: Partial<Receipt> & { issue: number }): Receipt =>
        ({
            version: 1,
            role: "implement",
            outcome: "pr-open",
            branch: "feat/issue-1",
            worktree: "/x",
            targetFiles: ["a.ts"],
            proofOfFailure: [],
            ...over,
        }) as Receipt;

    it("collapses a large batch to counts, without capping the counts themselves", () => {
        const receipts: Receipt[] = [
            ...Array.from({ length: 200 }, (_, i) => missing(`sess-${i}`)),
            work({ issue: 1, outcome: "pr-open" }),
            work({ issue: 2, outcome: "pr-open" }),
        ];
        const summary = summarizeReceipts(receipts);
        expect(summary.total).toBe(202);
        expect(summary.counts).toEqual(
            expect.arrayContaining([
                { role: "missing", outcome: "missing", count: 200 },
                { role: "implement", outcome: "pr-open", count: 2 },
            ])
        );
        // A count row exists per DISTINCT (role, outcome) pair, never per
        // receipt — this is the part of the fix that must not itself grow
        // unboundedly on a batch with many distinct pairs.
        expect(summary.counts).toHaveLength(2);
    });

    it("surfaces wip/failed/blocking/collision rows individually — the ones an operator must act on", () => {
        const receipts: Receipt[] = [
            work({ issue: 1, outcome: "wip", reason: "still red" }),
            work({ issue: 2, outcome: "failed", reason: "gate red" }),
            {
                version: 1,
                role: "review",
                issue: 3,
                outcome: "blocking",
                pr: 300,
                findings: ["x"],
            },
            work({ issue: 4, outcome: "collision", reason: "branch owned" }),
        ];
        const summary = summarizeReceipts(receipts);
        expect(summary.interesting.map((r) => r.issue)).toEqual([1, 2, 3, 4]);
    });

    it("does NOT surface approve/pr-open/missing rows individually — noise once the count is visible", () => {
        const receipts: Receipt[] = [
            work({ issue: 1, outcome: "pr-open" }),
            missing("sess-1"),
            {
                version: 1,
                role: "review",
                issue: 2,
                outcome: "approve",
                pr: 200,
                findings: [],
            },
        ];
        expect(summarizeReceipts(receipts).interesting).toEqual([]);
    });

    it("caps the interesting list at INTERESTING_RECEIPTS_CAP, keeping the true total honest", () => {
        const receipts: Receipt[] = Array.from({ length: 50 }, (_, i) =>
            work({ issue: i, outcome: "failed", reason: "gate red" })
        );
        const summary = summarizeReceipts(receipts);
        expect(summary.total).toBe(50);
        expect(summary.interesting).toHaveLength(INTERESTING_RECEIPTS_CAP);
        expect(summary.counts).toEqual([
            { role: "implement", outcome: "failed", count: 50 },
        ]);
    });
});

describe("loop-status — renderLoopStatusText", () => {
    it("renders the driver, claims, queue depth and receipt sections", () => {
        const status = buildLoopStatus(
            baseInput({
                claimedIssues: [
                    issue(42, "2026-08-18T11:30:00Z", "widget fix"),
                ],
                allBranches: ["feat/issue-42"],
                readyQueueIssues: [{ number: 1 }],
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 123,
                    pidAlive: true,
                },
            })
        );
        const text = renderLoopStatusText(status);
        expect(text).toContain("armed:      yes");
        expect(text).toContain("running (pid 123)");
        expect(text).toContain("#42");
        expect(text).toContain("branch pushed");
        expect(text).toContain("widget fix");
        expect(text).toContain("Queue depth");
        expect(text).toContain("total: 1");
        expect(text).toContain("Newest batch receipts (0)");
    });

    it("says 'none' for an empty claims list rather than printing nothing", () => {
        const status = buildLoopStatus(baseInput());
        expect(renderLoopStatusText(status)).toContain(
            "Claimed issues (0)\n  none"
        );
    });
});
