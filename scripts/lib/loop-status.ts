// The pure aggregation behind `bun run loop:status` and the dashboard's
// `GET /api/loop-status` route (#2519) — one screen answering "what is the
// loop working on right now", replacing the five-command mental join
// described in the issue: claimed-issue search, `loop:doctor`, a worktree
// grep, an open-PR list and a `tail -f` on the drain log.
//
// Two things are deliberately layered rather than merged into one derivation:
//
//   * live / orphan / suspect is `classifyClaim` from `loop-doctor.ts`,
//     IMPORTED, never re-derived — the acceptance criterion this issue is
//     built around. `buildClaimFacts`, also from `loop-doctor.ts`, is reused
//     the same way: it is the only place the branch/PR-suffix matching rules
//     live, so this module and `loop:doctor` can never quietly diverge on
//     what "has a branch" means.
//   * the finer `claimed → worktree → branch pushed → PR open → merging`
//     STAGE the issue asks for is a SEPARATE pure function, `computeStage`,
//     over the SAME branch/PR facts plus one fact `classifyClaim` never sees
//     (does a worktree exist?) and one it structurally cannot see (has a
//     review already approved this PR?). It does not fork or replace
//     `classifyClaim`'s verdict — a `ClaimRow` carries both, side by side.
//     `classifyClaim` stays the sole authority on live/orphan/suspect; this
//     function only ever refines "live" into where along the pipeline it
//     currently sits.
//
// Everything in this file is pure or deterministic-given-its-inputs: every
// fact arrives already fetched, as plain data or an already-parsed structure.
// The impure gathering (`gh` calls, `git` calls, file reads) lives in the CLI
// wrapper (`scripts/loop-status.ts`) and the server route
// (`scripts/telemetry-serve.ts`) — this module is testable against
// hand-built fixtures with no network and no filesystem (`readDriverState`
// and `readRecentPasses` are the two exceptions: they read real files, but
// deterministically off an injected directory, so a test drives them with a
// real `mkdtempSync` tmpdir rather than mocking `fs`).

import * as fs from "node:fs";
import * as path from "node:path";
import {
    buildClaimFacts,
    classifyClaim,
    type ClaimedIssue,
    type ClaimVerdict,
} from "../loop-doctor";
import type { BoardPriority } from "./queue-plan";
import type { Receipt, ReviewReceipt } from "./receipt";

// ─────────────────────────────────────────────────────────────────────────────
// Stage
// ─────────────────────────────────────────────────────────────────────────────

export type ClaimStage =
    | "claimed"
    | "worktree"
    | "branch pushed"
    | "PR open"
    | "merging";

export interface StageFacts {
    hasWorktree: boolean;
    hasBranch: boolean;
    hasOpenPr: boolean;
    /** An `approve` review receipt exists for this issue in the current batch. */
    reviewApproved: boolean;
}

export function computeStage(facts: StageFacts): ClaimStage {
    if (facts.hasOpenPr && facts.reviewApproved) return "merging";
    if (facts.hasOpenPr) return "PR open";
    if (facts.hasBranch) return "branch pushed";
    if (facts.hasWorktree) return "worktree";
    return "claimed";
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree fact — the one input classifyClaim never sees.
// ─────────────────────────────────────────────────────────────────────────────

/** A worktree dir is named `<repo>-issue-N` (see the brief in issue #2519 and
 *  `scripts/loop-doctor.ts`'s branch-suffix pattern, which this mirrors for a
 *  hyphen-joined path segment rather than a slash-joined branch name). */
const WORKTREE_ISSUE_RE = /(?:^|-)issue-(\d+)$/;

/** Which claimed issues currently have a local worktree, from
 *  `worktree-gc.ts`'s `parseWorktreeList` output — reused rather than a
 *  second porcelain parser. */
export function worktreeIssueNumbers(entries: { path: string }[]): Set<number> {
    const out = new Set<number>();
    for (const e of entries) {
        const match = WORKTREE_ISSUE_RE.exec(path.basename(e.path));
        if (match) out.add(Number(match[1]));
    }
    return out;
}

/**
 * Which issues have an `approve` verdict on their NEWEST review round, from
 * the batch's own receipts — the "reviewApproved" fact `computeStage` needs
 * for the `merging` stage. Only the highest `round` per issue counts: a
 * `blocking` round-1 followed by an `approve` round-2 (the fixup loop) must
 * read as approved, not blocked.
 */
export function approvedReviewIssues(receipts: Receipt[]): Set<number> {
    const newestByIssue = new Map<number, ReviewReceipt>();
    for (const r of receipts) {
        if (r.role !== "review") continue;
        const round = r.round ?? 1;
        const existing = newestByIssue.get(r.issue);
        if (!existing || round > (existing.round ?? 1)) {
            newestByIssue.set(r.issue, r);
        }
    }
    const out = new Set<number>();
    for (const [issue, r] of newestByIssue) {
        if (r.outcome === "approve") out.add(issue);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claims
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimRow {
    issue: number;
    title: string;
    stage: ClaimStage;
    verdict: ClaimVerdict;
    priority: BoardPriority | null;
    ageHours: number;
}

export interface QueueDepth {
    P0: number;
    P1: number;
    P2: number;
    unprioritized: number;
    total: number;
}

export interface ReadyQueueIssue {
    number: number;
}

/** Ready-for-agent, UNCLAIMED issues, split by board priority. Unprioritized
 *  sorts as its own bucket rather than folding into P2 — "nobody has looked
 *  at this yet" and "somebody looked and called it low" are different facts. */
export function queueDepthByPriority(
    issues: ReadyQueueIssue[],
    priority: Record<number, BoardPriority>
): QueueDepth {
    const depth: QueueDepth = {
        P0: 0,
        P1: 0,
        P2: 0,
        unprioritized: 0,
        total: issues.length,
    };
    for (const issue of issues) {
        const p = priority[issue.number];
        if (p === "P0") depth.P0++;
        else if (p === "P1") depth.P1++;
        else if (p === "P2") depth.P2++;
        else depth.unprioritized++;
    }
    return depth;
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver state — armed / pid / stop-file / recent passes.
// ─────────────────────────────────────────────────────────────────────────────

export interface DriverPassLine {
    epoch: number;
    pass: number;
    claudeExit: number;
    /** Left as a string — "n/a" is a valid value, not a parse failure. */
    pct: string;
    queueBefore: number;
    queueAfter: number;
    reason: string;
}

export interface DriverState {
    armed: boolean;
    pid: number | null;
    pidAlive: boolean;
    stopFilePresent: boolean;
    /** Newest-last, mirroring the log file's own append order. */
    recentPasses: DriverPassLine[];
}

/** One `loop-drain.log` line: `epoch pass claude_exit pct queue_before
 *  queue_after reason` (`scripts/loop-drain.sh`). `null` on a line that does
 *  not fit the shape — a truncated final line while the log is being
 *  appended to is normal, and dropping it silently is the wrong failure mode
 *  everywhere else in this loop, so callers see an empty result, never a
 *  thrown parse error. */
export function parseDriverPassLine(line: string): DriverPassLine | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) return null;
    const [epochStr, passStr, exitStr, pct, beforeStr, afterStr, ...rest] =
        parts;
    const reason = rest.join(" ");
    for (const n of [epochStr, passStr, exitStr, beforeStr, afterStr]) {
        if (!/^-?\d+$/.test(n)) return null;
    }
    return {
        epoch: Number(epochStr),
        pass: Number(passStr),
        claudeExit: Number(exitStr),
        pct,
        queueBefore: Number(beforeStr),
        queueAfter: Number(afterStr),
        reason,
    };
}

export function readRecentPasses(logPath: string, limit = 5): DriverPassLine[] {
    if (!fs.existsSync(logPath)) return [];
    const lines = fs
        .readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "");
    return lines
        .slice(-limit)
        .map(parseDriverPassLine)
        .filter((l): l is DriverPassLine => l !== null);
}

function defaultIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export interface ReadDriverStateOptions {
    telemetryDir: string;
    /** Test seam — defaults to a real `kill -0` liveness check. */
    isAlive?: (pid: number) => boolean;
    recentPassLimit?: number;
}

/** Reads the driver's on-disk state (`scripts/loop-handoff.sh`,
 *  `scripts/loop-drain.sh`) from an explicit `telemetryDir` — always the
 *  PRIMARY checkout's `.claude/telemetry`, never `cwd`'s, since these files
 *  are gitignored and a linked worktree has none of its own. */
export function readDriverState(opts: ReadDriverStateOptions): DriverState {
    const isAlive = opts.isAlive ?? defaultIsAlive;
    const confFile = path.join(opts.telemetryDir, "afk.conf");
    const pidFile = path.join(opts.telemetryDir, "loop-drain.pid");
    const stopFile = path.join(opts.telemetryDir, "loop-stop");
    const logFile = path.join(opts.telemetryDir, "loop-drain.log");

    const armed = fs.existsSync(confFile);

    let pid: number | null = null;
    if (fs.existsSync(pidFile)) {
        const raw = fs.readFileSync(pidFile, "utf8").trim();
        if (/^\d+$/.test(raw)) pid = Number(raw);
    }
    const pidAlive = pid !== null && isAlive(pid);
    const stopFilePresent = fs.existsSync(stopFile);
    const recentPasses = readRecentPasses(logFile, opts.recentPassLimit ?? 5);

    return { armed, pid, pidAlive, stopFilePresent, recentPasses };
}

// ─────────────────────────────────────────────────────────────────────────────
// The aggregate
// ─────────────────────────────────────────────────────────────────────────────

export interface LoopStatusInput {
    claimedIssues: ClaimedIssue[];
    prBranches: Set<string>;
    allBranches: string[];
    worktreeIssueNumbers: Set<number>;
    /** Issues whose newest review receipt (in `receipts`) is `approve`. */
    approvedReviewIssues: Set<number>;
    priority: Record<number, BoardPriority>;
    readyQueueIssues: ReadyQueueIssue[];
    /** The newest batch directory's receipts — see `newestBatchDir` in
     *  `lib/receipt.ts`. */
    receipts: Receipt[];
    driver: DriverState;
    now?: number;
    minAgeHours?: number;
}

export interface LoopStatus {
    driver: DriverState;
    claims: ClaimRow[];
    queueDepth: QueueDepth;
    receipts: Receipt[];
}

const PRIORITY_RANK: Record<BoardPriority, number> = { P0: 0, P1: 1, P2: 2 };
const UNPRIORITIZED_RANK = 3;

export function buildLoopStatus(input: LoopStatusInput): LoopStatus {
    const now = input.now ?? Date.now();

    const claims: ClaimRow[] = input.claimedIssues.map((issue) => {
        const facts = buildClaimFacts(
            issue,
            input.prBranches,
            input.allBranches,
            now
        );
        const verdict = classifyClaim(facts, input.minAgeHours);
        const stage = computeStage({
            hasWorktree: input.worktreeIssueNumbers.has(issue.number),
            hasBranch: facts.hasBranch,
            hasOpenPr: facts.hasOpenPr,
            reviewApproved: input.approvedReviewIssues.has(issue.number),
        });
        return {
            issue: issue.number,
            title: issue.title,
            stage,
            verdict,
            priority: input.priority[issue.number] ?? null,
            ageHours: facts.ageHours,
        };
    });

    // Board priority first (unprioritized last), then the older claim first
    // within a tier — the two axes an operator scanning the list actually
    // cares about.
    claims.sort((a, b) => {
        const ra = a.priority ? PRIORITY_RANK[a.priority] : UNPRIORITIZED_RANK;
        const rb = b.priority ? PRIORITY_RANK[b.priority] : UNPRIORITIZED_RANK;
        if (ra !== rb) return ra - rb;
        return b.ageHours - a.ageHours;
    });

    return {
        driver: input.driver,
        claims,
        queueDepth: queueDepthByPriority(
            input.readyQueueIssues,
            input.priority
        ),
        receipts: input.receipts,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Render — terminal text. `--json` bypasses this and prints `LoopStatus`
// itself; this is the human-readable side of the same aggregate.
// ─────────────────────────────────────────────────────────────────────────────

function verdictMark(state: ClaimVerdict["state"]): string {
    return state === "orphan" ? "×" : state === "suspect" ? "?" : "·";
}

export function renderLoopStatusText(status: LoopStatus): string {
    const lines: string[] = [];

    lines.push("Driver");
    lines.push(
        `  armed:      ${status.driver.armed ? "yes" : "no — end-of-pass handoff will not fire"}`
    );
    lines.push(
        `  pid:        ${
            status.driver.pid === null
                ? "no pid file"
                : status.driver.pidAlive
                  ? `running (pid ${status.driver.pid})`
                  : `NOT running (stale pid file, pid ${status.driver.pid})`
        }`
    );
    lines.push(
        `  stop-file:  ${status.driver.stopFilePresent ? "PRESENT — nothing will start until it is removed" : "absent"}`
    );
    if (status.driver.recentPasses.length === 0) {
        lines.push("  recent passes: none recorded");
    } else {
        lines.push("  recent passes:");
        for (const p of status.driver.recentPasses) {
            lines.push(
                `    pass ${p.pass}  exit=${p.claudeExit}  pct=${p.pct}  queue ${p.queueBefore}→${p.queueAfter}  ${p.reason}`
            );
        }
    }

    lines.push("");
    lines.push(`Claimed issues (${status.claims.length})`);
    if (status.claims.length === 0) {
        lines.push("  none");
    } else {
        for (const c of status.claims) {
            lines.push(
                `  ${verdictMark(c.verdict.state)} #${c.issue}  [${c.priority ?? "—"}]  ${c.stage.padEnd(13)}  ${c.ageHours.toFixed(1)}h  ${c.title.slice(0, 48)}`
            );
        }
    }

    lines.push("");
    lines.push("Queue depth (ready-for-agent, unclaimed)");
    lines.push(
        `  P0: ${status.queueDepth.P0}  P1: ${status.queueDepth.P1}  P2: ${status.queueDepth.P2}  ` +
            `unprioritized: ${status.queueDepth.unprioritized}  total: ${status.queueDepth.total}`
    );

    lines.push("");
    lines.push(`Newest batch receipts (${status.receipts.length})`);
    if (status.receipts.length === 0) {
        lines.push("  none");
    } else {
        for (const r of status.receipts) {
            if (r.role === "missing") {
                lines.push(`  missing  session=${r.session}`);
            } else {
                const pr = "pr" in r && r.pr ? `  PR #${r.pr}` : "";
                lines.push(`  #${r.issue}  ${r.role}  ${r.outcome}${pr}`);
            }
        }
    }

    return lines.join("\n") + "\n";
}
