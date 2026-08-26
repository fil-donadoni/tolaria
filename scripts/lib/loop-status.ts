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
    type BranchNames,
    type ClaimedIssue,
    type ClaimVerdict,
} from "../loop-doctor";
import type { BoardPriority } from "./queue-plan";
import type { Receipt, ReviewReceipt } from "./receipt";

// ─────────────────────────────────────────────────────────────────────────────
// Stage
// ─────────────────────────────────────────────────────────────────────────────

/** Every stage a claimed issue can be in, least-progressed first. A runtime
 *  array for the same reason as `CLAIM_VERDICT_STATES` and
 *  `LOOP_VERDICT_STATES`: the dashboard glossary's completeness test (#2629)
 *  iterates it, so a stage added here cannot ship without a human label. */
export const CLAIM_STAGES = [
    "claimed",
    "worktree",
    "branch pushed",
    "PR open",
    "merging",
] as const;

export type ClaimStage = (typeof CLAIM_STAGES)[number];

export interface StageFacts {
    hasWorktree: boolean;
    /**
     * A branch on the REMOTE. Local-only deliberately does not count: this
     * stage is literally called "branch pushed", and a pass killed mid-edit
     * leaves its local branch on disk forever (see `ClaimFacts.hasLocalBranch`
     * in `loop-doctor.ts`), so counting it here reported dead work as one step
     * further along the pipeline than it ever reached.
     */
    hasRemoteBranch: boolean;
    hasOpenPr: boolean;
    /** An `approve` review receipt exists for this issue in the current batch. */
    reviewApproved: boolean;
}

export function computeStage(facts: StageFacts): ClaimStage {
    if (facts.hasOpenPr && facts.reviewApproved) return "merging";
    if (facts.hasOpenPr) return "PR open";
    if (facts.hasRemoteBranch) return "branch pushed";
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
    branches: BranchNames;
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
    /**
     * Set by `gatherLoopStatus` when the claimed-issue / ready-queue read
     * FAILED (`GatheredLoopStatus`). They exist so the verdict is derived
     * exactly ONCE, here, with the same fail-closed knowledge the CLI and
     * the dashboard have — rather than a second `deriveLoopVerdict` call at
     * the gather layer that could drift from this one. Absent/`null` means
     * the read succeeded, which is what every hand-built fixture wants.
     */
    claimsError?: string | null;
    queueDepthError?: string | null;
}

/** One (role, outcome) bucket's count — the aggregate `receiptsSummary`
 *  reduces the full receipt list to, so a display surface never has to
 *  iterate the whole batch just to say how many of what there were. */
export interface ReceiptCount {
    role: string;
    outcome: string;
    count: number;
}

/**
 * `receipts`, reduced (PR #2545 review, finding 3). A live batch measured at
 * 232 receipts, nearly all `missing session=…` markers — rendering the raw
 * list blew the CLI to 165 lines and the dashboard panel to 3000-8000px,
 * pushing everything below it off-screen on a phone. The issue asks for "one
 * screen", so every surface (CLI, API payload, dashboard panel) renders this
 * summary instead of the raw array: counts by (role, outcome) — cheap,
 * complete, no cap needed — plus the individual rows an operator actually
 * needs to act on (`wip` / `failed` / `blocking` / `collision`), capped.
 * `approve` / `pr-open` / `missing` receipts are noise in aggregate once
 * their COUNT is visible, so they never appear as individual rows here.
 */
export interface ReceiptsSummary {
    /** `receipts.length` — the true total, even though `interesting` is capped. */
    total: number;
    counts: ReceiptCount[];
    /** Rows that need a human's attention, newest-batch-order, capped at
     *  `INTERESTING_RECEIPTS_CAP`. */
    interesting: Receipt[];
}

/** An outcome worth surfacing as an individual row rather than folding into
 *  `counts` — the ones that mean something is NOT simply done. */
const INTERESTING_OUTCOMES: ReadonlySet<string> = new Set([
    "wip",
    "failed",
    "blocking",
    "collision",
]);

/** However bad a pass, this is still "one screen" of individual rows. */
export const INTERESTING_RECEIPTS_CAP = 20;

export function summarizeReceipts(receipts: Receipt[]): ReceiptsSummary {
    const counts = new Map<string, number>();
    for (const r of receipts) {
        const key = `${r.role} ${r.outcome}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
        total: receipts.length,
        counts: [...counts.entries()].map(([key, count]) => {
            const [role, outcome] = key.split(" ");
            return { role: role!, outcome: outcome!, count };
        }),
        interesting: receipts
            .filter((r) => INTERESTING_OUTCOMES.has(r.outcome))
            .slice(0, INTERESTING_RECEIPTS_CAP),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict (#2624) — ONE derivation of "what is the loop doing, and is it
// healthy", shared by `bun run loop:status` and the dashboard so the two can
// never tell an operator different things.
//
// It exists because of the night of 2026-08-19 (PRD #2621): the driver died
// at 00:58 holding five claims and stayed dead for eight hours, and both
// surfaces reported the outage as `armed · no driver pid · no stop-file` —
// three independent facts, hand-concatenated twice (`renderDriverLines` here,
// `renderLoopStatus` in `telemetry-dashboard.html`), neither ranking them,
// neither naming a cause or a remedy.
//
// THREE THINGS THIS IS NOT:
//
//   * It is NOT `loop-drain.sh`'s `no_progress_streak`. That detector is
//     LIVE, inside the driver process, pass-over-pass, off the total open
//     `ready-for-agent` count and the green SHA — inputs this function
//     structurally cannot see (a snapshot has no history and no SHA). Its
//     consequence is stopping the driver; this one's consequence is a
//     sentence on a screen. Re-deriving a weaker "no progress" from the data
//     here would produce a plausible-but-wrong `STALLED`, so it is not
//     attempted: the only progress statement made below is the one the
//     snapshot genuinely supports (`claimsHeld`).
//   * It does NOT re-derive live/orphan/suspect. `classifyClaim`
//     (`loop-doctor.ts`) is the sole authority; `ClaimRow.verdict` already
//     carries its output, and this function only ever COUNTS it. No second
//     age threshold is introduced here — deliberately, since a threshold
//     that disagreed with `loop:doctor` is exactly the divergence the module
//     header is about.
//   * It is NOT a view. The sentence and the remedy live here rather than in
//     a renderer precisely because two renderers exist.
// ─────────────────────────────────────────────────────────────────────────────

/** Every state a verdict can take, HIGHEST precedence first — the order
 *  `deriveLoopVerdict` resolves them in, and the list the dashboard's tone
 *  map is checked against (`loop-status-dashboard.test.ts`), so a state added
 *  here cannot ship unstyled on the page. */
export const LOOP_VERDICT_STATES = [
    "NEEDS ATTENTION",
    "STALLED",
    "STOPPED",
    "RUNNING",
    "IDLE",
] as const;

export type LoopVerdictState = (typeof LOOP_VERDICT_STATES)[number];

/** Why a verdict came out the way it did. Codes are stable identifiers a
 *  surface can style or filter on; `detail` is the prose it renders. */
export type LoopFindingCode =
    | "failed-reads"
    | "orphaned-claims"
    | "claims-held";

export interface LoopFinding {
    code: LoopFindingCode;
    detail: string;
}

export interface LoopVerdict {
    state: LoopVerdictState;
    /** One plain-English sentence naming the CAUSE. */
    sentence: string;
    /** What to do next, naming the command. */
    remedy: string;
    /** The evidence behind the verdict — reported whichever state won, so a
     *  `STOPPED` loop still says how many claims are outstanding. */
    findings: LoopFinding[];
}

/**
 * The `claims-held` predicate (#2624 AC), exported on its own so
 * `loop-drain.sh` can consume it in a later ticket without importing a view.
 *
 * A pass whose claim count ROSE and whose merge count stayed at zero did not
 * find "nothing to do" — it took work and lost it. That distinction is the
 * whole point: on 2026-08-19 two killed passes left five claims held, and the
 * next passes reported `no-progress`, which reads as "there was nothing to
 * do" when the truth was "there was work and it was lost".
 */
export interface PassClaimAccounting {
    /** Claims held at the start of the window. */
    claimsBefore: number;
    /** Claims held at the end of it. */
    claimsAfter: number;
    /** Work the window actually LANDED — merged PRs / closed issues. */
    merges: number;
}

export function claimsHeld(a: PassClaimAccounting): boolean {
    return a.claimsAfter > a.claimsBefore && a.merges === 0;
}

/**
 * The snapshot's accounting, for the predicate above.
 *
 * `loop:status` and the dashboard are handed "what is true NOW", never "what
 * changed across the last pass", so the window is not a pass — it is "since
 * the loop last held nothing". Both endpoints are then exact rather than
 * estimated:
 *
 *   * `claimsBefore: 0` — every claim standing right now is one the loop took
 *     and has not given back.
 *   * `merges: 0` — a claim that LANDED is neither open nor labelled
 *     `in-progress`, so it is not in this list at all. Over the set of
 *     currently-held claims the merge count is zero by construction, not by
 *     estimate. (This is also why no merge count is invented from receipts:
 *     `Receipt` has no merged role/outcome, and guessing one would be the
 *     fail-open shape.)
 *
 * The rise half is therefore true whenever anything is claimed, which on its
 * own would fire on every healthy pass mid-flight. The guard is not a smaller
 * before-count — it is the liveness gate at the call site: `deriveLoopVerdict`
 * only consults this when the driver is NOT alive, because a live driver
 * holding claims is ordinary work in progress. A live driver holding claims
 * that went BAD is covered by `classifyClaim`'s orphan verdict instead, which
 * is why no threshold is duplicated here.
 */
function snapshotClaimAccounting(heldClaims: number): PassClaimAccounting {
    return { claimsBefore: 0, claimsAfter: heldClaims, merges: 0 };
}

export interface LoopVerdictInput {
    driver: DriverState;
    /** `null` means the read FAILED (see `GatheredLoopStatus`), never "none". */
    claims: ClaimRow[] | null;
    claimsError: string | null;
    queueDepth: QueueDepth | null;
    queueDepthError: string | null;
}

const REMEDY = {
    reads: "check `gh auth status` and the API rate limit, then re-run `bun run loop:status`",
    orphans:
        "`bun run loop:doctor` to inspect, `bun run loop:doctor --release` to drop `in-progress` on the orphans",
    start: "`bun run loop:afk` starts a detached driver",
    resume: "`bun run loop:afk --resume` clears the stop-file and starts a driver",
    arm: "`bun run loop:afk` arms the loop and starts a driver",
    none: "nothing to do — `bun run loop:afk --stop` asks the driver to stop after the current pass",
    feed: "label issues `ready-for-agent` to give the loop work",
} as const;

/**
 * PRECEDENCE (#2624): `NEEDS ATTENTION` > `STALLED` > `STOPPED` > `RUNNING` >
 * `IDLE`. A blocked tree outranks a liveness fact, because a live driver
 * holding orphaned claims still makes no progress while looking healthy.
 *
 * Two refinements this function AUTHORS, because no precedence between
 * `armed` / `pidAlive` / `stopFilePresent` existed anywhere before it:
 *
 *   1. `claims-held` escalates to STALLED, not to NEEDS ATTENTION. NEEDS
 *      ATTENTION exists for what liveness CANNOT show — orphans under a
 *      healthy-looking driver, and reads that failed. When the driver is
 *      visibly down, STALLED already names the cause and carries the same
 *      remedy, and escalating would bury the more specific diagnosis. The
 *      finding is still reported either way. It also closes the hole that
 *      the queue-depth test alone leaves: claiming an issue REMOVES it from
 *      the unclaimed queue (`count_unclaimed` in `loop-drain.sh`), so a dead
 *      driver holding every remaining issue would otherwise read as `IDLE`
 *      — precisely the 2026-08-19 shape, one pass later.
 *
 *      `claims-held` escalates REGARDLESS of `armed` (PR #2771 review). Only
 *      the queue-depth half of STALLED is armed-gated: an unarmed loop with a
 *      full queue is a loop nobody asked to run, which IDLE describes
 *      correctly. Held claims are not that — the work was already TAKEN, and
 *      nothing unarmed will give it back. Not-armed is a durable state, not a
 *      corner case: `--disarm` deliberately does not stop a running driver
 *      (`scripts/loop-handoff.sh`, `docs/guides/afk-loop.md`), so the pass
 *      that dies after a disarm holds its claims with `armed: false`, and an
 *      interactive `/process-gh-issues` checkout is never armed at all.
 *      Gating on `armed` painted both worlds IDLE — the dashboard's `good`
 *      tone — for the whole 24h `classifyClaim` rope before the claims turn
 *      orphan, which is exactly the "looks healthy, makes no progress" shape
 *      this module exists to kill.
 *   2. A stop-file suppresses STALLED rather than losing to it. A deliberate
 *      stop is not a stall: with the stop-file present a dead driver is the
 *      EXPECTED state, so the STALLED condition does not hold and STOPPED
 *      wins without contradicting the order above. (STOPPED still outranks
 *      RUNNING, per the table: a driver alive under a stop-file is exiting
 *      after this pass, and "nothing will start" is the operative fact.)
 */
export function deriveLoopVerdict(input: LoopVerdictInput): LoopVerdict {
    const d = input.driver;
    const findings: LoopFinding[] = [];

    const readErrors = [input.claimsError, input.queueDepthError].filter(
        (e): e is string => e !== null
    );
    if (readErrors.length > 0) {
        findings.push({
            code: "failed-reads",
            detail: `${readErrors.length} of the loop's own reads failed (${readErrors.join("; ")}) — this is not the same as "nothing claimed, queue empty"`,
        });
    }

    // `ClaimRow.verdict` is `classifyClaim`'s output, consumed not re-derived.
    const claims = input.claims ?? [];
    const orphans = claims.filter((c) => c.verdict.state === "orphan");
    if (orphans.length > 0) {
        findings.push({
            code: "orphaned-claims",
            detail: `${orphans.length} claimed issue(s) are orphaned (${orphans.map((c) => `#${c.issue}`).join(", ")}) — nothing in the loop will release them`,
        });
    }

    // See `snapshotClaimAccounting` for why the liveness gate, and not a
    // smaller before-count, is what keeps this off a healthy pass.
    const heldWithDriverDown =
        !d.pidAlive &&
        input.claimsError === null &&
        claimsHeld(snapshotClaimAccounting(claims.length));
    if (heldWithDriverDown) {
        findings.push({
            code: "claims-held",
            detail: `no driver is running, yet ${claims.length} issue(s) are still claimed — that work was taken and never landed, which is not "nothing to do"`,
        });
    }

    const needsAttention = findings.some(
        (f) => f.code === "failed-reads" || f.code === "orphaned-claims"
    );
    const queueTotal = input.queueDepth?.total ?? 0;
    const stalled =
        !d.pidAlive &&
        !d.stopFilePresent &&
        (heldWithDriverDown || (d.armed && queueTotal > 0));

    if (needsAttention) {
        // Failed reads first: when a read failed, every other number on the
        // screen is suspect, so saying WHY the screen cannot be trusted
        // outranks anything derived from it.
        const readFinding = findings.find((f) => f.code === "failed-reads");
        return {
            state: "NEEDS ATTENTION",
            sentence: readFinding
                ? "The loop's own reads failed, so this screen cannot tell you whether the loop is healthy."
                : `${orphans.length} claimed issue(s) are orphaned — claimed with nothing to show, and nothing left to release them.`,
            remedy: readFinding ? REMEDY.reads : REMEDY.orphans,
            findings,
        };
    }

    if (stalled) {
        // The unarmed branch must not borrow the armed sentence: "the loop is
        // armed" would be false, and the remedy has to ARM as well as start.
        return {
            state: "STALLED",
            sentence: d.armed
                ? `The loop is armed but no driver is running, and there is still work outstanding (queue ${queueTotal}, claimed ${claims.length}).`
                : `No driver is running and the loop is not armed, yet ${claims.length} issue(s) are still claimed (queue ${queueTotal}) — that work will not move on its own.`,
            remedy: d.armed ? REMEDY.start : REMEDY.arm,
            findings,
        };
    }

    if (d.stopFilePresent) {
        return {
            state: "STOPPED",
            sentence:
                "A stop-file is present — nothing will start until it is removed.",
            remedy: REMEDY.resume,
            findings,
        };
    }

    if (d.pidAlive) {
        return {
            state: "RUNNING",
            sentence: `The driver is running (pid ${d.pid}), working through the queue (${queueTotal} unclaimed, ${claims.length} claimed).`,
            remedy: REMEDY.none,
            findings,
        };
    }

    if (!d.armed) {
        return {
            state: "IDLE",
            sentence: `The loop is not armed — the end-of-pass handoff will not fire, and ${queueTotal} issue(s) are waiting.`,
            remedy: REMEDY.arm,
            findings,
        };
    }

    return {
        state: "IDLE",
        sentence:
            "The loop is armed, nothing is claimed and the queue is empty — there is nothing to do.",
        remedy: REMEDY.feed,
        findings,
    };
}

export interface LoopStatus {
    driver: DriverState;
    claims: ClaimRow[];
    queueDepth: QueueDepth;
    receiptsSummary: ReceiptsSummary;
    /** The one shared derivation (#2624) — see `deriveLoopVerdict`. */
    verdict: LoopVerdict;
}

const PRIORITY_RANK: Record<BoardPriority, number> = { P0: 0, P1: 1, P2: 2 };
const UNPRIORITIZED_RANK = 3;

export function buildLoopStatus(input: LoopStatusInput): LoopStatus {
    const now = input.now ?? Date.now();

    const claims: ClaimRow[] = input.claimedIssues.map((issue) => {
        const facts = buildClaimFacts(
            issue,
            input.prBranches,
            input.branches,
            now
        );
        const verdict = classifyClaim(facts, input.minAgeHours);
        const stage = computeStage({
            hasWorktree: input.worktreeIssueNumbers.has(issue.number),
            hasRemoteBranch: facts.hasRemoteBranch,
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

    const queueDepth = queueDepthByPriority(
        input.readyQueueIssues,
        input.priority
    );
    const claimsError = input.claimsError ?? null;
    const queueDepthError = input.queueDepthError ?? null;

    return {
        driver: input.driver,
        claims,
        queueDepth,
        receiptsSummary: summarizeReceipts(input.receipts),
        verdict: deriveLoopVerdict({
            driver: input.driver,
            // A failed read contributes `null`, never the empty value
            // `buildLoopStatus` had to substitute to compute the rest —
            // that substitution is exactly what must not reach a verdict.
            claims: claimsError === null ? claims : null,
            claimsError,
            queueDepth: queueDepthError === null ? queueDepth : null,
            queueDepthError,
        }),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed section wrapper (#2519 round 3, finding 5).
//
// `gatherLoopStatus` shells out to `gh` for several independent facts —
// claimed issues, the unclaimed ready-for-agent queue, open-PR/branch state.
// The historical `sh` helper both those and `fetchBoardPriority` used to
// call rendered a failed read as `""`/`[]` — indistinguishable from "the
// call succeeded and there is genuinely nothing there". Observed live with
// the account's GraphQL quota at 0/5000: `claims: 0`, `queueDepth: {total:
// 0}`, reads exactly like an idle loop with an empty queue — the loop's own
// documented STOP CONDITION — at the exact moment GitHub was unreachable.
//
// `priorityWarning` already had the right shape (a `string | null` set by
// `onError`, never folded into the data it describes). `Section<T>` is that
// same idiom generalized to a value that itself must never default to
// "empty" — a discriminated union makes `{status:"error", data: []}`
// unrepresentable, not just discouraged.
// ─────────────────────────────────────────────────────────────────────────────

export type Section<T> =
    | { status: "ok"; data: T }
    | { status: "error"; error: string };

/** Runs `fn`, wrapping a thrown error into `Section`'s `error` branch rather
 *  than letting it propagate — the seam a fixture test injects a
 *  throwing/succeeding `fn` into (no live `gh` call needed), and the seam
 *  `gatherLoopStatus` calls with the real, throwing `gh`/`git` runners
 *  (`shChecked` in `loop-doctor.ts`). `label` prefixes the message so a CLI
 *  or dashboard reader knows WHICH read failed without inspecting the call
 *  site. */
export function gatherSection<T>(fn: () => T, label: string): Section<T> {
    try {
        return { status: "ok", data: fn() };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { status: "error", error: `${label}: ${message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render — terminal text. `--json` bypasses this and prints `LoopStatus`
// (or, for the CLI/dashboard, the section-aware `GatheredLoopStatus` in
// `scripts/loop-status.ts`) directly; this is the human-readable side.
// ─────────────────────────────────────────────────────────────────────────────

function verdictMark(state: ClaimVerdict["state"]): string {
    return state === "orphan" ? "×" : state === "suspect" ? "?" : "·";
}

/**
 * The verdict band — FIRST thing `bun run loop:status` prints (#2624 AC), and
 * the same three strings the dashboard renders, so the two surfaces cannot
 * word the same state differently. Findings print under it: the verdict says
 * what state the loop is in, the findings say what is outstanding regardless
 * of which state won.
 */
export function renderVerdictLines(verdict: LoopVerdict): string[] {
    const lines = [
        `LOOP: ${verdict.state}`,
        `  ${verdict.sentence}`,
        `  → ${verdict.remedy}`,
    ];
    if (verdict.findings.length > 0) {
        lines.push("  findings:");
        for (const f of verdict.findings) {
            lines.push(`    · ${f.code}: ${f.detail}`);
        }
    }
    return lines;
}

export function renderDriverLines(driver: DriverState): string[] {
    const lines: string[] = [];
    lines.push("Driver");
    lines.push(
        `  armed:      ${driver.armed ? "yes" : "no — end-of-pass handoff will not fire"}`
    );
    lines.push(
        `  pid:        ${
            driver.pid === null
                ? "no pid file"
                : driver.pidAlive
                  ? `running (pid ${driver.pid})`
                  : `NOT running (stale pid file, pid ${driver.pid})`
        }`
    );
    lines.push(
        `  stop-file:  ${driver.stopFilePresent ? "PRESENT — nothing will start until it is removed" : "absent"}`
    );
    if (driver.recentPasses.length === 0) {
        lines.push("  recent passes: none recorded");
    } else {
        lines.push("  recent passes:");
        for (const p of driver.recentPasses) {
            lines.push(
                `    pass ${p.pass}  exit=${p.claudeExit}  pct=${p.pct}  queue ${p.queueBefore}→${p.queueAfter}  ${p.reason}`
            );
        }
    }
    return lines;
}

/**
 * `claims === null` / `error !== null` means the read failed — rendered as
 * an explicit UNAVAILABLE banner, never as `Claimed issues (0)` /
 * `none`, which is what a healthy empty read looks like and is exactly the
 * confusion finding 5 is about.
 */
export function renderClaimsLines(
    claims: ClaimRow[] | null,
    error: string | null
): string[] {
    const lines: string[] = [];
    if (error !== null) {
        lines.push("Claimed issues: UNAVAILABLE");
        lines.push(`  ${error}`);
        lines.push(
            '  cannot tell whether anything is claimed — do NOT read this as "0 claimed"'
        );
        return lines;
    }
    const list = claims ?? [];
    lines.push(`Claimed issues (${list.length})`);
    if (list.length === 0) {
        lines.push("  none");
    } else {
        for (const c of list) {
            lines.push(
                `  ${verdictMark(c.verdict.state)} #${c.issue}  [${c.priority ?? "—"}]  ${c.stage.padEnd(13)}  ${c.ageHours.toFixed(1)}h  ${c.title.slice(0, 48)}`
            );
        }
    }
    return lines;
}

/** See `renderClaimsLines` — same UNAVAILABLE-not-zero contract for the
 *  queue depth section. */
export function renderQueueDepthLines(
    queueDepth: QueueDepth | null,
    error: string | null
): string[] {
    const lines: string[] = [];
    lines.push("Queue depth (ready-for-agent, unclaimed)");
    if (error !== null) {
        lines.push(`  UNAVAILABLE — ${error}`);
        lines.push(
            '  cannot tell how deep the queue is — do NOT read this as "queue empty"'
        );
        return lines;
    }
    const qd = queueDepth ?? {
        P0: 0,
        P1: 0,
        P2: 0,
        unprioritized: 0,
        total: 0,
    };
    lines.push(
        `  P0: ${qd.P0}  P1: ${qd.P1}  P2: ${qd.P2}  ` +
            `unprioritized: ${qd.unprioritized}  total: ${qd.total}`
    );
    return lines;
}

export function renderReceiptsLines(summary: ReceiptsSummary): string[] {
    const lines: string[] = [];
    lines.push(`Newest batch receipts (${summary.total})`);
    if (summary.total === 0) {
        lines.push("  none");
    } else {
        // Counts first — cheap, complete, no cap. `approve`/`pr-open`/
        // `missing` receipts are noise as individual rows once their count
        // is visible, so only the rows that need attention print below.
        for (const c of summary.counts) {
            lines.push(`  ${c.role} ${c.outcome}: ${c.count}`);
        }
        if (summary.interesting.length > 0) {
            lines.push("  needs attention:");
            for (const r of summary.interesting) {
                // `interesting` only ever holds wip/failed/blocking/collision
                // rows, none of which is the `missing` role — but the union
                // type still requires the branch to satisfy TypeScript.
                if (r.role === "missing") continue;
                const pr = "pr" in r && r.pr ? `  PR #${r.pr}` : "";
                lines.push(`    #${r.issue}  ${r.role}  ${r.outcome}${pr}`);
            }
        }
    }
    return lines;
}

export function renderLoopStatusText(status: LoopStatus): string {
    return (
        [
            ...renderVerdictLines(status.verdict),
            "",
            ...renderDriverLines(status.driver),
            "",
            ...renderClaimsLines(status.claims, null),
            "",
            ...renderQueueDepthLines(status.queueDepth, null),
            "",
            ...renderReceiptsLines(status.receiptsSummary),
        ].join("\n") + "\n"
    );
}
