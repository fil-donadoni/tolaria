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
    renderClaimsLines,
    renderQueueDepthLines,
    renderVerdictLines,
    gatherSection,
    summarizeReceipts,
    claimsHeld,
    deriveLoopVerdict,
    INTERESTING_RECEIPTS_CAP,
    passesInWindow,
    TIMELINE_WINDOW_HOURS,
    type LoopStatusInput,
    type LoopVerdictInput,
    type DriverState,
    type ClaimRow,
    type QueueDepth,
    type DriverPassLine,
} from "../lib/loop-status";
import { type ClaimedIssue, type ClaimVerdict } from "../loop-doctor";
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
        branches: { local: [], remote: [] },
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
                hasRemoteBranch: false,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("claimed");
    });

    it("advances to 'worktree' once a worktree exists, before any branch is pushed", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasRemoteBranch: false,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("worktree");
    });

    it("advances to 'branch pushed' — a worktree fact does not regress the stage", () => {
        expect(
            computeStage({
                hasWorktree: false,
                hasRemoteBranch: true,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("branch pushed");
    });

    it("a LOCAL-only branch does not reach 'branch pushed'", () => {
        // The stage is named for the push. A pass killed mid-edit leaves its
        // local branch on disk forever, so counting it here would report dead
        // work as further along than it ever got — the same conflation that
        // let eight claims read as live for 25-36 hours (loop-doctor.ts,
        // ClaimFacts.hasLocalBranch).
        expect(
            computeStage({
                hasWorktree: true,
                hasRemoteBranch: false,
                hasOpenPr: false,
                reviewApproved: false,
            })
        ).toBe("worktree");
    });

    it("advances to 'PR open' once a PR exists", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasRemoteBranch: true,
                hasOpenPr: true,
                reviewApproved: false,
            })
        ).toBe("PR open");
    });

    it("only reaches 'merging' once a review has approved the open PR", () => {
        expect(
            computeStage({
                hasWorktree: true,
                hasRemoteBranch: true,
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
                hasRemoteBranch: true,
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

describe("loop-status — passesInWindow (#2631, the Now timeline's pass-block source)", () => {
    const pass = (epoch: number, n: number): DriverPassLine => ({
        epoch,
        pass: n,
        claudeExit: 0,
        pct: "1",
        queueBefore: 1,
        queueAfter: 1,
        reason: "-",
    });
    const NOW_SEC = 1_755_100_000;

    it("keeps a pass exactly at the cutoff and drops one a second older", () => {
        const cutoff = NOW_SEC - TIMELINE_WINDOW_HOURS * 3600;
        const passes = [pass(cutoff - 1, 1), pass(cutoff, 2), pass(NOW_SEC, 3)];
        const kept = passesInWindow(passes, NOW_SEC);
        expect(kept.map((p) => p.pass)).toEqual([2, 3]);
    });

    it("defaults to TIMELINE_WINDOW_HOURS, not a silently different window", () => {
        const justInside = pass(NOW_SEC - TIMELINE_WINDOW_HOURS * 3600 + 60, 1);
        const justOutside = pass(
            NOW_SEC - TIMELINE_WINDOW_HOURS * 3600 - 60,
            2
        );
        const kept = passesInWindow([justInside, justOutside], NOW_SEC);
        expect(kept.map((p) => p.pass)).toEqual([1]);
    });

    it("respects an explicit narrower window", () => {
        const passes = [
            pass(NOW_SEC - 5 * 3600, 1),
            pass(NOW_SEC - 1 * 3600, 2),
        ];
        expect(passesInWindow(passes, NOW_SEC, 2).map((p) => p.pass)).toEqual([
            2,
        ]);
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
                branches: { local: [], remote: ["feat/issue-42"] },
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
                branches: { local: [], remote: ["feat/issue-42"] },
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

/**
 * #2519 round 3, finding 5 — a failed `gh` read must render as UNAVAILABLE,
 * never as an empty/zeroed section indistinguishable from a healthy read
 * that genuinely found nothing. Observed live at 0/5000 GraphQL quota:
 * `claims: 0`, `queueDepth: {total: 0}` — the loop's own documented STOP
 * CONDITION, reported with total confidence at the exact moment GitHub was
 * unreachable.
 */
describe("loop-status — gatherSection (fail-closed section wrapper)", () => {
    it("wraps a successful read as {status:'ok', data}", () => {
        const section = gatherSection(() => [1, 2, 3], "widgets");
        expect(section).toEqual({ status: "ok", data: [1, 2, 3] });
    });

    it("wraps a THROWING read as {status:'error'} — never as an empty result", () => {
        const section = gatherSection(() => {
            throw new Error("GraphQL: API rate limit already exceeded");
        }, "claimed issues");
        expect(section.status).toBe("error");
        // The discriminated union makes `data` structurally absent on the
        // error branch — this assertion is the proof: a version of
        // `gatherSection` that swallowed the throw and returned `{status:
        // "ok", data: []}` (the exact historical bug) fails RIGHT HERE.
        expect("data" in section).toBe(false);
        if (section.status === "error") {
            expect(section.error).toBe(
                "claimed issues: GraphQL: API rate limit already exceeded"
            );
        }
    });

    it("prefixes the message with the caller-supplied label, not just the raw error", () => {
        const section = gatherSection(() => {
            throw new Error("exit 1");
        }, "ready-for-agent queue");
        expect(section.status === "error" && section.error).toBe(
            "ready-for-agent queue: exit 1"
        );
    });
});

function claimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
    return {
        issue: 42,
        title: "widget fix",
        stage: "branch pushed",
        verdict: { state: "live", reason: "branch pushed" },
        priority: null,
        ageHours: 3,
        ...overrides,
    };
}

describe("loop-status — renderClaimsLines (unavailable vs. zero)", () => {
    it("renders a real, non-empty claims list when there is no error", () => {
        const lines = renderClaimsLines([claimRow()], null).join("\n");
        expect(lines).toContain("Claimed issues (1)");
        expect(lines).toContain("#42");
        expect(lines).toContain("widget fix");
    });

    it("renders UNAVAILABLE — not 'Claimed issues (0)' / 'none' — when the read failed", () => {
        const lines = renderClaimsLines(
            null,
            "claimed issues: GraphQL: API rate limit already exceeded"
        ).join("\n");
        expect(lines).toContain("UNAVAILABLE");
        expect(lines).toContain("rate limit");
        // This is the assertion that would have caught the shipped bug: a
        // regression that fell back to rendering `claims ?? []` here would
        // print exactly this string.
        expect(lines).not.toContain("Claimed issues (0)");
        expect(lines).not.toContain("none");
    });
});

describe("loop-status — renderQueueDepthLines (unavailable vs. zero)", () => {
    it("renders real counts when there is no error", () => {
        const lines = renderQueueDepthLines(
            { P0: 1, P1: 2, P2: 0, unprioritized: 3, total: 6 },
            null
        ).join("\n");
        expect(lines).toContain("total: 6");
    });

    it("renders UNAVAILABLE — not 'total: 0' — when the read failed", () => {
        const lines = renderQueueDepthLines(
            null,
            "ready-for-agent queue: GraphQL: API rate limit already exceeded"
        ).join("\n");
        expect(lines).toContain("UNAVAILABLE");
        expect(lines).toContain("rate limit");
        // The literal string a zeroed, "healthy but empty" queue would have
        // printed — proves this path never falls back to it.
        expect(lines).not.toContain("total: 0");
    });

    it("one section erroring does not touch the OTHER, healthy section's real values", () => {
        // Mirrors what `renderGatheredLoopStatusText` composes in
        // `scripts/loop-status.ts`: claims unavailable, queue depth fine.
        const claimsLines = renderClaimsLines(
            null,
            "claimed issues: boom"
        ).join("\n");
        const queueLines = renderQueueDepthLines(
            { P0: 0, P1: 1, P2: 0, unprioritized: 0, total: 1 },
            null
        ).join("\n");
        expect(claimsLines).toContain("UNAVAILABLE");
        expect(queueLines).toContain("total: 1");
        expect(queueLines).not.toContain("UNAVAILABLE");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verdict engine (#2624)
// ─────────────────────────────────────────────────────────────────────────────

/** A `ClaimRow` in whatever verdict state the case under test needs.
 *  `classifyClaim`'s output is an INPUT here — the verdict engine counts it,
 *  it never re-derives it, so a fixture states it directly. */
function verdictClaim(
    issue: number,
    state: ClaimVerdict["state"],
    overrides: Partial<ClaimRow> = {}
): ClaimRow {
    return {
        issue,
        title: `issue ${issue}`,
        stage: "claimed",
        verdict: { state, reason: `${state} (fixture)` } as ClaimVerdict,
        priority: null,
        ageHours: 12,
        ...overrides,
    };
}

function verdictInput(
    overrides: Partial<LoopVerdictInput> = {}
): LoopVerdictInput {
    return {
        driver: EMPTY_DRIVER,
        claims: [],
        claimsError: null,
        queueDepth: { P0: 0, P1: 0, P2: 0, unprioritized: 0, total: 0 },
        queueDepthError: null,
        ...overrides,
    };
}

function queue(total: number): QueueDepth {
    return { P0: 0, P1: 0, P2: 0, unprioritized: total, total };
}

/**
 * The `claims-held` predicate on its own (#2624 AC: exported separately so
 * `loop-drain.sh` can consume it without importing a view). These are the
 * DRAIN-shaped rows — a real pass boundary, with a real merge count — which
 * is the window the snapshot consumers cannot observe and the drain can.
 */
describe("loop-status — claimsHeld predicate (#2624)", () => {
    it("fires when the claim count rose and nothing merged — work taken, not 'nothing to do'", () => {
        expect(claimsHeld({ claimsBefore: 0, claimsAfter: 5, merges: 0 })).toBe(
            true
        );
    });

    it("does NOT fire when the pass merged something, however many claims it took", () => {
        expect(claimsHeld({ claimsBefore: 0, claimsAfter: 5, merges: 1 })).toBe(
            false
        );
    });

    it("does NOT fire when the claim count did not rise — a pass that genuinely found nothing to do", () => {
        expect(claimsHeld({ claimsBefore: 3, claimsAfter: 3, merges: 0 })).toBe(
            false
        );
    });

    it("does NOT fire when claims were RELEASED rather than taken", () => {
        expect(claimsHeld({ claimsBefore: 5, claimsAfter: 2, merges: 0 })).toBe(
            false
        );
    });
});

describe("loop-status — deriveLoopVerdict (#2624)", () => {
    it("RUNNING when the driver process is alive", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 4242,
                    pidAlive: true,
                },
                queueDepth: queue(12),
            })
        );
        expect(v.state).toBe("RUNNING");
        expect(v.sentence).toContain("4242");
        expect(v.remedy).toContain("loop:afk --stop");
    });

    it("IDLE when armed with no driver and an empty queue", () => {
        const v = deriveLoopVerdict(
            verdictInput({ driver: { ...EMPTY_DRIVER, armed: true } })
        );
        expect(v.state).toBe("IDLE");
        expect(v.findings).toEqual([]);
        expect(v.remedy).toContain("ready-for-agent");
    });

    it("IDLE, naming 'not armed' as the cause, when the conf is absent", () => {
        const v = deriveLoopVerdict(
            verdictInput({ driver: EMPTY_DRIVER, queueDepth: queue(7) })
        );
        expect(v.state).toBe("IDLE");
        expect(v.sentence).toContain("not armed");
        expect(v.remedy).toContain("loop:afk");
    });

    it("STOPPED when the stop-file is present", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    stopFilePresent: true,
                },
            })
        );
        expect(v.state).toBe("STOPPED");
        expect(v.remedy).toContain("--resume");
    });

    it("STALLED when armed, the driver is not alive and the queue is non-empty", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: { ...EMPTY_DRIVER, armed: true, pid: 99 },
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("STALLED");
        expect(v.sentence).toContain("195");
        expect(v.remedy).toContain("loop:afk");
    });

    it("NEEDS ATTENTION when a claim is orphaned, even under a live driver", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                },
                claims: [
                    verdictClaim(2582, "orphan"),
                    verdictClaim(2583, "orphan"),
                ],
                queueDepth: queue(3),
            })
        );
        expect(v.state).toBe("NEEDS ATTENTION");
        expect(v.findings.map((f) => f.code)).toContain("orphaned-claims");
        expect(v.findings[0]!.detail).toContain("#2582");
        expect(v.remedy).toContain("loop:doctor --release");
    });

    it("NEEDS ATTENTION when a read failed — never a verdict derived from the substituted zero", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                },
                claims: null,
                claimsError: "claimed issues: API rate limit exceeded",
                queueDepth: null,
                queueDepthError: "ready-for-agent queue: API rate limit",
            })
        );
        expect(v.state).toBe("NEEDS ATTENTION");
        expect(v.sentence).toContain("cannot tell you whether the loop is");
        expect(v.findings.map((f) => f.code)).toContain("failed-reads");
        // The historical bug, spelled out: a failed read must never be
        // reported as the healthy shape it is indistinguishable from.
        expect(v.state).not.toBe("RUNNING");
    });

    it("STALLED, not IDLE, when a dead driver holds every remaining claim and the queue reads empty", () => {
        // Claiming an issue REMOVES it from the unclaimed queue
        // (`count_unclaimed`, loop-drain.sh), so the queue-depth test alone
        // would call the worst state of the loop "nothing to do".
        const v = deriveLoopVerdict(
            verdictInput({
                driver: { ...EMPTY_DRIVER, armed: true, pid: 99 },
                claims: [verdictClaim(1, "live"), verdictClaim(2, "live")],
                queueDepth: queue(0),
            })
        );
        expect(v.state).toBe("STALLED");
        expect(v.findings.map((f) => f.code)).toContain("claims-held");
    });

    it("STALLED, not IDLE, when the loop is NOT armed and a dead driver still holds claims", () => {
        // Gating the claims-held escalation on `armed` painted this world
        // IDLE — the dashboard's `good` tone — while five issues sat stuck.
        // Not-armed is durable, not a corner case: `--disarm` deliberately
        // does not stop a running driver (`loop-handoff.sh`), and an
        // interactive `/process-gh-issues` checkout is never armed at all.
        const v = deriveLoopVerdict(
            verdictInput({
                driver: { ...EMPTY_DRIVER, armed: false, pid: 99 },
                claims: [
                    verdictClaim(1, "live"),
                    verdictClaim(2, "live"),
                    verdictClaim(3, "live"),
                    verdictClaim(4, "live"),
                    verdictClaim(5, "live"),
                ],
                queueDepth: queue(0),
            })
        );
        expect(v.state).toBe("STALLED");
        expect(v.findings.map((f) => f.code)).toContain("claims-held");
        // The sentence must not claim the loop is armed, and must not say
        // there is nothing outstanding.
        expect(v.sentence).toContain("not armed");
        expect(v.sentence).toContain("5 issue(s) are still claimed");
        expect(v.remedy).toContain("loop:afk");
    });

    it("stays IDLE when the loop is NOT armed, the driver is dead and NOTHING is claimed — a queue nobody asked to run", () => {
        // The companion bound: only the CLAIMS half of STALLED is
        // armed-independent. An unarmed loop with a full queue has taken no
        // work, so IDLE ('arm it') remains the honest verdict.
        const v = deriveLoopVerdict(
            verdictInput({
                driver: { ...EMPTY_DRIVER, armed: false, pid: 99 },
                claims: [],
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("IDLE");
        expect(v.findings).toEqual([]);
    });

    it("reports NO claims-held finding while the driver is alive — ordinary work in progress", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                },
                claims: [verdictClaim(1, "live"), verdictClaim(2, "suspect")],
                queueDepth: queue(4),
            })
        );
        expect(v.state).toBe("RUNNING");
        expect(v.findings).toEqual([]);
    });
});

describe("loop-status — verdict precedence (#2624)", () => {
    const deadArmedDriver: DriverState = {
        ...EMPTY_DRIVER,
        armed: true,
        pid: 99,
    };

    it("NEEDS ATTENTION outranks STALLED — a blocked tree beats a liveness fact", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: deadArmedDriver,
                claims: [verdictClaim(2582, "orphan")],
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("NEEDS ATTENTION");
    });

    it("failed reads outrank orphaned claims in the SENTENCE — every other number is suspect", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: deadArmedDriver,
                claims: [verdictClaim(2582, "orphan")],
                claimsError: "claimed issues: boom",
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("NEEDS ATTENTION");
        expect(v.remedy).toContain("gh auth status");
    });

    it("STALLED outranks RUNNING's absence and IDLE — armed, dead, work outstanding", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: deadArmedDriver,
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("STALLED");
    });

    it("a stop-file makes a dead driver STOPPED, not STALLED — a deliberate stop is not a stall", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: { ...deadArmedDriver, stopFilePresent: true },
                claims: [verdictClaim(1, "live")],
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("STOPPED");
        // The evidence still prints — the verdict picks a state, it does not
        // suppress what is outstanding.
        expect(v.findings.map((f) => f.code)).toContain("claims-held");
    });

    it("STOPPED outranks RUNNING — a live driver under a stop-file is exiting after this pass", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                    stopFilePresent: true,
                },
                queueDepth: queue(195),
            })
        );
        expect(v.state).toBe("STOPPED");
    });

    it("RUNNING outranks IDLE — a live driver with an empty queue is not idle", () => {
        const v = deriveLoopVerdict(
            verdictInput({
                driver: {
                    ...EMPTY_DRIVER,
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                },
            })
        );
        expect(v.state).toBe("RUNNING");
    });
});

/**
 * The night this module exists for (PRD #2621): the driver died at 00:58
 * holding five claims and stayed dead for eight hours, and both surfaces
 * rendered it as `armed · no driver pid · no stop-file`.
 *
 * The five claims classify as `live`, not orphaned — each was a pass killed
 * mid-edit, leaving a local branch that `classifyClaim` gives a 24h rope
 * (`localOnlyBranchHours`), and twelve hours is inside it. That is precisely
 * why the outage was invisible: `loop:doctor` said the claims were fine.
 */
describe("loop-status — the 2026-08-19 outage as a fixture (#2624)", () => {
    const status = () =>
        buildLoopStatus(
            baseInput({
                driver: {
                    armed: true,
                    pid: 41234,
                    pidAlive: false,
                    stopFilePresent: false,
                    recentPasses: [],
                },
                claimedIssues: [
                    issue(2582, "2026-08-19T00:58:00Z"),
                    issue(2583, "2026-08-19T00:58:00Z"),
                    issue(2584, "2026-08-19T00:58:00Z"),
                    issue(2585, "2026-08-19T00:58:00Z"),
                    issue(2586, "2026-08-19T00:58:00Z"),
                ],
                // Killed mid-edit: local branches, never pushed, no PRs.
                branches: {
                    local: [
                        "feat/issue-2582",
                        "feat/issue-2583",
                        "feat/issue-2584",
                        "feat/issue-2585",
                        "feat/issue-2586",
                    ],
                    remote: [],
                },
                prBranches: new Set<string>(),
                readyQueueIssues: Array.from({ length: 195 }, (_, i) => ({
                    number: 5000 + i,
                })),
                now: new Date("2026-08-19T12:58:00Z").getTime(),
            })
        );

    it("classifies the five claims as live — twelve hours is inside classifyClaim's local-branch rope", () => {
        expect(status().claims.map((c) => c.verdict.state)).toEqual([
            "live",
            "live",
            "live",
            "live",
            "live",
        ]);
    });

    it("yields STALLED with a claims-held finding — never the grey three-clause subtitle", () => {
        const v = status().verdict;
        expect(v.state).toBe("STALLED");
        expect(v.findings.map((f) => f.code)).toContain("claims-held");
        expect(
            v.findings.find((f) => f.code === "claims-held")!.detail
        ).toContain("5 issue(s) are still claimed");
        expect(v.sentence).toContain("195");
        expect(v.remedy).toContain("bun run loop:afk");
    });
});

describe("loop-status — renderVerdictLines (#2624)", () => {
    it("prints the verdict, its sentence and its remedy at the top of loop:status", () => {
        const status = buildLoopStatus(
            baseInput({
                driver: { ...EMPTY_DRIVER, armed: true, pid: 99 },
                readyQueueIssues: [{ number: 1 }],
            })
        );
        const text = renderLoopStatusText(status);
        expect(text.startsWith("LOOP: STALLED\n")).toBe(true);
        expect(text).toContain("The loop is armed but no driver is running");
        expect(text).toContain("→ `bun run loop:afk` starts a detached driver");
    });

    it("lists each finding under the band", () => {
        const lines = renderVerdictLines({
            state: "NEEDS ATTENTION",
            sentence: "s",
            remedy: "r",
            findings: [{ code: "orphaned-claims", detail: "2 orphaned" }],
        });
        expect(lines).toContain("  findings:");
        expect(lines).toContain("    · orphaned-claims: 2 orphaned");
    });
});
