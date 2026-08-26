#!/usr/bin/env bun
// `bun run loop:status` — one screen for "what is the loop working on right
// now" (issue #2519), replacing the five-command mental join described
// there: a claimed-issue search, `loop:doctor`, a worktree grep, an open-PR
// list, and a `tail -f` on the drain log.
//
// This wrapper holds NO decisions. `gatherLoopStatus` gathers the raw facts
// (`gh`, `git`, and the driver/receipt files under the PRIMARY checkout's
// `.claude/telemetry` and `.claude/receipts`) and hands them to
// `buildLoopStatus` in `lib/loop-status.ts`, which is pure and imports
// `classifyClaim`/`buildClaimFacts` from `loop-doctor.ts` rather than
// re-deriving "in flight" a second time.
//
// `gatherLoopStatus` is EXPORTED so `telemetry-serve.ts`'s
// `GET /api/loop-status` route calls the exact same gathering this CLI does,
// rather than a third re-implementation of the same five-command join.
//
// Usage:
//   bun run loop:status
//   bun run loop:status --json
//   bun run loop:status --no-priority   # skip the board read (same escape
//                                        # hatch as queue:plan)

import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    fetchBoardPriority,
    NO_PRIORITY_WARNING,
    type BoardPriority,
} from "./lib/board-priority";
import {
    newestBatchDir,
    readReceiptsFromDir,
    RECEIPTS_ROOT,
    type ReceiptFileError,
} from "./lib/receipt";
import { parseWorktreeList } from "./worktree-gc";
import {
    fetchBranchNames,
    fetchClaimedIssues,
    fetchOpenPrBranches,
    shChecked,
    type ShRunner,
} from "./loop-doctor";
import {
    approvedReviewIssues,
    buildLoopStatus,
    gatherSection,
    passesInWindow,
    readDriverState,
    readRecentPasses,
    renderClaimsLines,
    renderDriverLines,
    renderQueueDepthLines,
    renderReceiptsLines,
    renderVerdictLines,
    TIMELINE_WINDOW_HOURS,
    worktreeIssueNumbers,
    type ClaimRow,
    type DriverPassLine,
    type DriverState,
    type LoopVerdict,
    type MergedPr,
    type QueueDepth,
    type ReadyQueueIssue,
    type ReceiptsSummary,
} from "./lib/loop-status";

// Same trap as every other script that shells `gh`: bun auto-loads
// `.env.local`, whose GITHUB_TOKEN shadows the developer's gh keyring login.
const NET_ENV: NodeJS.ProcessEnv = (() => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
})();

function sh(cmd: string, args: string[], cwd: string): string {
    const r = spawnSync(cmd, args, { encoding: "utf8", env: NET_ENV, cwd });
    return r.status === 0 ? r.stdout.trim() : "";
}

function gh(args: string[]): string {
    return sh("gh", args, process.cwd());
}

/** Fail-CLOSED counterpart of `gh` — throws (carrying stderr) on a non-zero
 *  exit instead of returning `""`. See `shChecked` in `loop-doctor.ts`: `""`
 *  is indistinguishable from "gh succeeded and printed nothing", which is
 *  exactly the shape of #2519 round 3 finding 5 (a rate-limited
 *  `gh issue list --label ready-for-agent` rendering as "queue empty"). Used
 *  for every read whose failure must surface as UNAVAILABLE, never as zero. */
function ghChecked(args: string[]): string {
    const r = spawnSync("gh", args, {
        encoding: "utf8",
        env: NET_ENV,
        cwd: process.cwd(),
    });
    if (r.status !== 0) {
        throw new Error(
            `gh ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim() || `exit ${r.status}`}`
        );
    }
    return r.stdout.trim();
}

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";
const PROJECT_ITEM_LIMIT = 2000;

/** What `fetchPriorityGracefully` returns — also the shape of the long-lived
 *  cache `telemetry-serve.ts` keeps for it (PR #2545 review, finding 2). */
export interface GracefulPriority {
    priority: Record<number, BoardPriority>;
    warning: string | null;
}

/**
 * `loop:status` is READ-ONLY observability, not a scheduling decision — a
 * missing `read:project` scope here must not crash the whole view the way
 * `queue:plan`'s `die()` deliberately does (there, a wrong sort silently
 * mis-orders real work; here, a missing priority column is cosmetic).
 * Degrade gracefully: priorities render as unknown, print ONE warning line.
 *
 * EXPORTED so `telemetry-serve.ts` can call it directly for its own
 * board-priority cache (finding 2, below) rather than going through
 * `gatherLoopStatus` every poll — the board read (`gh project item-list
 * --limit 2000` + a `project view` cross-check) is what dominates the
 * route's latency (measured 41s cold, 27.6s on a "cached" hit whose 10s TTL
 * had already expired mid-gather) and is also the least volatile part of the
 * payload, so it gets its OWN, much longer TTL, decoupled from the rest.
 */
export function fetchPriorityGracefully(noPriority: boolean): GracefulPriority {
    if (noPriority) {
        // `fetchBoardPriority`'s skip branch deliberately never calls
        // `onError` (PR #2545 review, finding 1) — it warns on its own and
        // makes no `gh` call. Mirror the same message here, via the shared
        // constant, without paying for a call we already know will skip.
        return { priority: {}, warning: NO_PRIORITY_WARNING };
    }
    let warning: string | null = null;
    const priority = fetchBoardPriority({
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
        itemLimit: PROJECT_ITEM_LIMIT,
        onError: (message) => {
            warning ??= message.split("\n")[0]!;
        },
    });
    return { priority, warning };
}

/** Ready-for-agent issues with no `in-progress` label — the unclaimed queue.
 *  `runner` defaults to the swallow-on-failure `gh` (kept for anything that
 *  still wants the old degrade-to-empty behaviour); `gatherLoopStatus` below
 *  passes `ghChecked` so a failed read throws instead of reading as an empty
 *  queue. */
export function fetchUnclaimedReadyQueue(
    runner: (args: string[]) => string = gh
): ReadyQueueIssue[] {
    const raw = JSON.parse(
        runner([
            "issue",
            "list",
            "--label",
            "ready-for-agent",
            "--state",
            "open",
            "--json",
            "number,labels",
            "--limit",
            "300",
        ]) || "[]"
    ) as { number: number; labels: { name: string }[] }[];
    return raw
        .filter((i) => !i.labels.some((l) => l.name === "in-progress"))
        .map((i) => ({ number: i.number }));
}

/**
 * A page size big enough that an ordinary day never truncates: the PR's own
 * verification measured a real 40-41-merge day (a #2842 review flagged the
 * original 50 as "one busy day from silently dropping data" — headroom, not
 * a ceiling calibrated to what was observed once). `fetchRecentMergedPrs`
 * still reports when even THIS was not enough, rather than let a genuinely
 * record day look like a complete read.
 */
const MERGED_PR_FETCH_LIMIT = 200;

/**
 * `fetchRecentMergedPrs`'s result: the filtered, in-window PRs plus whether
 * the underlying `gh` page could have missed one (#2842 review finding).
 *
 * `raw.length === limit` ALONE is not the right test, and was measured wrong
 * live on this repo: the page is sorted by `updated`, not `merged` (`gh pr
 * list` has no finer-than-a-day "merged after TIMESTAMP" filter), and a
 * `--search sort:updated-desc` page exhausts its `limit` on almost every
 * poll — this repo's own automation relabels/comments on old, long-merged
 * PRs constantly, so 200 rows sorted by "touched most recently" reaches back
 * WEEKS before it reaches 200, even though every PR actually merged in the
 * last 24h sits at the very top. Flagging every one of those as truncated
 * would be a truncation banner permanently on, i.e. noise, not a signal.
 *
 * The tight test uses the ordering the API actually promises: since merging
 * a PR is itself an update, `updatedAt >= mergedAt` always — so any PR
 * merged within the window necessarily has `updatedAt` within the window
 * too, and sorting by `updated-desc` is GUARANTEED to surface it before the
 * page runs out, UNLESS the page's own limit is exhausted before its
 * `updatedAt` values even reach back past the window's cutoff. That is
 * `raw.length === limit && the OLDEST row we got still has updatedAt >=
 * cutoff` — a page that ran out mid-window, not merely a full page.
 */
export interface MergedPrFetchResult {
    prs: MergedPr[];
    truncated: boolean;
}

/**
 * PRs merged within `windowHours` — the Now timeline's merge-tick data
 * source (#2631). Nothing in the existing gather already carries this:
 * `Receipt` has no merged outcome (only `pr-open`), and the driver's own log
 * records only a bash-local `merges` count that is never written to a line
 * (`scripts/loop-drain.sh`'s `claims_held_check` comment). So this is a new
 * read, mirroring `fetchUnclaimedReadyQueue`'s shape: `gh` has no
 * finer-than-a-day "merged after TIMESTAMP" filter, so this over-fetches a
 * bounded, newest-first page (`sort:updated-desc`) and filters precisely by
 * `mergedAt` in JS, the same two-step `fetchUnclaimedReadyQueue` already
 * uses for its own client-side `in-progress` filter.
 */
export function fetchRecentMergedPrs(
    windowHours: number,
    runner: (args: string[]) => string = ghChecked,
    limit: number = MERGED_PR_FETCH_LIMIT
): MergedPrFetchResult {
    const cutoffMs = Date.now() - windowHours * 3600_000;
    const raw = JSON.parse(
        runner([
            "pr",
            "list",
            "--state",
            "merged",
            "--search",
            "sort:updated-desc",
            "--json",
            "number,title,mergedAt,updatedAt",
            "--limit",
            String(limit),
        ]) || "[]"
    ) as {
        number: number;
        title: string;
        mergedAt: string | null;
        updatedAt: string;
    }[];
    const prs = raw
        .filter(
            (
                pr
            ): pr is {
                number: number;
                title: string;
                mergedAt: string;
                updatedAt: string;
            } => pr.mergedAt !== null && Date.parse(pr.mergedAt) >= cutoffMs
        )
        .map((pr) => ({
            number: pr.number,
            title: pr.title,
            mergedAt: pr.mergedAt,
        }));
    // The page ran out (`raw.length === limit`) AND it ran out before its
    // own `updatedAt` values crossed back past the window's cutoff — see
    // `MergedPrFetchResult`'s doc comment. A page that fills up on rows all
    // older than the window (this repo's routine shape: old PRs relabelled
    // recently) still fully covers the window and is NOT truncated.
    const oldestUpdatedMs =
        raw.length > 0 ? Date.parse(raw[raw.length - 1]!.updatedAt) : -Infinity;
    const truncated = raw.length >= limit && oldestUpdatedMs >= cutoffMs;
    return { prs, truncated };
}

export interface GatherLoopStatusOptions {
    noPriority?: boolean;
    /**
     * A pre-fetched board priority — when provided, `gatherLoopStatus` skips
     * `fetchPriorityGracefully` (and therefore the `gh` board read) entirely
     * and uses this instead. This is what lets `telemetry-serve.ts` keep the
     * board read on its own long-lived cache (PR #2545 review, finding 2)
     * while every other fact in the gather is re-fetched on the route's
     * normal, shorter TTL. Ignored when `noPriority` is also set — an
     * explicit `--no-priority` always wins over a stale override.
     */
    priorityOverride?: GracefulPriority;
    /**
     * Test seam (#2519 round 3, finding 5) — the runner behind the claimed-
     * issue / open-PR / branch-list reads. Defaults to the real, fail-closed
     * `shChecked`. A test injects a throwing (or canned-JSON) fixture here
     * so `gatherLoopStatus`'s claims-unavailable branch is provable without
     * a live `gh`/`git` call — never used by production code, which always
     * takes the default.
     */
    claimsRunner?: ShRunner;
    /** Test seam for the ready-for-agent queue read. Defaults to the real
     *  `ghChecked`. See `claimsRunner`. */
    queueRunner?: (args: string[]) => string;
    /** Test seam for the recently-merged-PR read (#2631). Defaults to the
     *  real `ghChecked`. See `claimsRunner`. */
    mergedPrRunner?: (args: string[]) => string;
}

/**
 * The CLI/dashboard-facing shape (#2519 round 3, finding 5) — `claims` and
 * `queueDepth` are `null` when their underlying `gh`/`git` read failed,
 * paired with a sibling `*Error` message, mirroring the `priorityWarning`
 * idiom that already existed for the board read. `null` (not `[]` / a
 * zeroed `QueueDepth`) makes "the read failed" structurally impossible to
 * confuse with "the read succeeded and found nothing" — the exact
 * confusion that shipped: with the account's GraphQL quota at 0/5000, this
 * payload rendered `claims: 0` and `queueDepth: {total: 0}`, indistinguishable
 * from an idle loop with an empty queue (the loop's own documented STOP
 * CONDITION) at the exact moment GitHub was unreachable.
 */
export interface GatheredLoopStatus {
    /**
     * The one shared verdict (#2624) — `deriveLoopVerdict`, computed inside
     * `buildLoopStatus` with the section errors below in hand. Both this
     * CLI and the dashboard render THESE strings; neither re-words the
     * driver's three facts into a health statement of its own, which is how
     * the 2026-08-19 outage came to read as `armed · no driver pid ·
     * no stop-file` on both surfaces at once.
     */
    verdict: LoopVerdict;
    driver: DriverState;
    claims: ClaimRow[] | null;
    claimsError: string | null;
    queueDepth: QueueDepth | null;
    queueDepthError: string | null;
    receiptsSummary: ReceiptsSummary;
    batch: string | null;
    priorityWarning: string | null;
    receiptErrors: ReceiptFileError[];
    /**
     * Passes started in the last `TIMELINE_WINDOW_HOURS` (#2631) — the Now
     * timeline's pass-block data source. A LOCAL read off `loop-drain.log`,
     * like `driver.recentPasses`: no `gh`/`git` call, so (mirroring
     * `DriverState`'s own contract) it has no failure mode and therefore no
     * `*Error` sibling — an unreadable/missing log renders as `[]`, which is
     * also the correct rendering of "no passes ran".
     */
    timelinePasses: DriverPassLine[];
    /**
     * PRs merged in the last `TIMELINE_WINDOW_HOURS` (#2631) — the Now
     * timeline's merge-tick data source. `gh`-backed, so — mirroring
     * `claims`/`queueDepth` — a failed read is `null` with a sibling
     * `recentMergesError`, never a fabricated empty list (#2519 round 3,
     * finding 5's contract, extended to this new read).
     */
    recentMerges: MergedPr[] | null;
    recentMergesError: string | null;
    /**
     * True when `fetchRecentMergedPrs`'s underlying `gh` page was exhausted
     * (#2842 review finding) — the fetch limit is generous (200, ~5x a real
     * measured 40-41-merge day), but a busy enough day can still hit it, and
     * silent truncation reads as "everything is here" when it is not.
     * `false`, never `null`, on a failed read (`recentMergesError` already
     * covers "cannot tell" — truncation is a property of a SUCCESSFUL page,
     * not a second failure mode).
     */
    recentMergesTruncated: boolean;
}

/**
 * All the impure gathering (`gh`, `git`, and the primary checkout's
 * `.claude/telemetry` + `.claude/receipts`), then `buildLoopStatus`. The one
 * function both the CLI (`main`, below) and `telemetry-serve.ts`'s
 * `/api/loop-status` route call — the join happens exactly once.
 *
 * The claimed-issue/PR/branch reads and the ready-queue read each go through
 * `gatherSection` with the fail-CLOSED `shChecked`/`ghChecked` runners
 * (`loop-doctor.ts`), so a failed `gh` call surfaces as an explicit error
 * rather than the historical swallow-to-`""`/`[]` — see `GatheredLoopStatus`.
 */
export function gatherLoopStatus(
    opts: GatherLoopStatusOptions = {}
): GatheredLoopStatus {
    const primary = primaryCheckout();
    const telemetryDir = path.join(primary, ".claude", "telemetry");
    const receiptsRoot = path.join(primary, RECEIPTS_ROOT);

    // Bundled as ONE section: `buildClaimFacts` needs all three to classify
    // a claim correctly (hasBranch/hasOpenPr), so a failure in any one of
    // them makes the whole claims computation unreliable, not just one
    // field of it — reporting the other two as if they were trustworthy
    // would be a narrower version of the same fail-open bug.
    const claimsRunner = opts.claimsRunner ?? shChecked;
    const claimsInputs = gatherSection(() => {
        const claimedIssues = fetchClaimedIssues(claimsRunner);
        const prBranches = fetchOpenPrBranches(claimsRunner);
        const branches = fetchBranchNames(claimsRunner);
        return { claimedIssues, prBranches, branches };
    }, "claimed issues / open PRs / branch list");

    const queueRunner = opts.queueRunner ?? ghChecked;
    const readyQueueSection = gatherSection(
        () => fetchUnclaimedReadyQueue(queueRunner),
        "ready-for-agent queue"
    );

    // #2631 — the Now timeline's merge-tick data source. `gh`-backed, so
    // fail-closed via `gatherSection` like every other `gh` read here: a
    // failed fetch must render as "cannot tell", never as "nothing merged".
    const mergedPrRunner = opts.mergedPrRunner ?? ghChecked;
    const mergedPrsSection = gatherSection(
        () => fetchRecentMergedPrs(TIMELINE_WINDOW_HOURS, mergedPrRunner),
        "recently merged PRs"
    );

    // `git worktree list` is a LOCAL read (no network, no `gh`) — outside
    // this finding's scope (a GitHub outage cannot cause it to fail) and
    // its only effect on failure is a coarser `stage` (falls back to
    // "claimed" instead of "worktree"), never a fabricated zero.
    const worktreePorcelain = sh(
        "git",
        ["worktree", "list", "--porcelain"],
        primary
    );
    const worktrees = parseWorktreeList(worktreePorcelain);

    const { priority, warning } =
        opts.priorityOverride && !opts.noPriority
            ? opts.priorityOverride
            : fetchPriorityGracefully(opts.noPriority ?? false);

    const batch = newestBatchDir(receiptsRoot);
    const { receipts, errors } = batch
        ? readReceiptsFromDir(path.join(receiptsRoot, batch))
        : { receipts: [], errors: [] };

    const driver = readDriverState({ telemetryDir });

    // #2631 — the Now timeline's pass-block data source. A LOCAL read, like
    // `driver` itself: `readRecentPasses` already reads the WHOLE log file
    // into memory regardless of `limit` (`.slice(-limit)` runs after the
    // read), so a generous limit costs nothing extra and simply avoids
    // truncating a busy night's passes before `passesInWindow` gets to
    // filter by time. `readDriverState`'s own `recentPasses` (capped at 5,
    // for the driver light/section) is untouched — this is a SEPARATE read
    // of the same file for a different consumer with a different window.
    const timelinePasses = passesInWindow(
        readRecentPasses(path.join(telemetryDir, "loop-drain.log"), 10_000),
        Math.floor(Date.now() / 1000)
    );

    const status = buildLoopStatus({
        claimedIssues:
            claimsInputs.status === "ok" ? claimsInputs.data.claimedIssues : [],
        prBranches:
            claimsInputs.status === "ok"
                ? claimsInputs.data.prBranches
                : new Set(),
        branches:
            claimsInputs.status === "ok"
                ? claimsInputs.data.branches
                : { local: [], remote: [] },
        worktreeIssueNumbers: worktreeIssueNumbers(worktrees),
        approvedReviewIssues: approvedReviewIssues(receipts),
        priority,
        readyQueueIssues:
            readyQueueSection.status === "ok" ? readyQueueSection.data : [],
        receipts,
        driver,
        // The verdict is derived inside `buildLoopStatus`; it needs to know
        // a section FAILED rather than seeing the empty value substituted
        // just above, which is indistinguishable from a healthy zero.
        claimsError: claimsInputs.status === "ok" ? null : claimsInputs.error,
        queueDepthError:
            readyQueueSection.status === "ok" ? null : readyQueueSection.error,
    });

    return {
        verdict: status.verdict,
        driver: status.driver,
        claims: claimsInputs.status === "ok" ? status.claims : null,
        claimsError: claimsInputs.status === "ok" ? null : claimsInputs.error,
        queueDepth:
            readyQueueSection.status === "ok" ? status.queueDepth : null,
        queueDepthError:
            readyQueueSection.status === "ok" ? null : readyQueueSection.error,
        receiptsSummary: status.receiptsSummary,
        batch: batch ?? null,
        priorityWarning: warning,
        receiptErrors: errors,
        timelinePasses,
        recentMerges:
            mergedPrsSection.status === "ok" ? mergedPrsSection.data.prs : null,
        recentMergesError:
            mergedPrsSection.status === "ok" ? null : mergedPrsSection.error,
        recentMergesTruncated:
            mergedPrsSection.status === "ok"
                ? mergedPrsSection.data.truncated
                : false,
    };
}

/** The section-aware sibling of `lib/loop-status.ts`'s `renderLoopStatusText`
 *  — same line-builders, but claims/queueDepth render an UNAVAILABLE banner
 *  instead of a zeroed section when their read failed. */
export function renderGatheredLoopStatusText(
    gathered: GatheredLoopStatus
): string {
    return (
        [
            ...renderVerdictLines(gathered.verdict),
            "",
            ...renderDriverLines(gathered.driver),
            "",
            ...renderClaimsLines(gathered.claims, gathered.claimsError),
            "",
            ...renderQueueDepthLines(
                gathered.queueDepth,
                gathered.queueDepthError
            ),
            "",
            ...renderReceiptsLines(gathered.receiptsSummary),
        ].join("\n") + "\n"
    );
}

function main(): void {
    const asJson = process.argv.includes("--json");
    const noPriority = process.argv.includes("--no-priority");

    const gathered = gatherLoopStatus({ noPriority });

    // A partial read is a genuinely different exit than a clean one — a
    // caller scripting off this CLI (cron, a watchdog) must be able to tell
    // "the loop is idle" from "the reads failed and I don't actually know",
    // which is exactly the distinction the JSON `claims`/`queueDepth: null`
    // shape exists to preserve. `priorityWarning` stays cosmetic-only (its
    // own long-standing contract, unchanged here) — only a section that can
    // render as a false "0"/"empty" moves the exit code.
    if (gathered.claimsError || gathered.queueDepthError) {
        process.exitCode = 1;
    }

    if (asJson) {
        console.log(JSON.stringify(gathered, null, 2));
        return;
    }

    if (gathered.priorityWarning)
        console.error(`⚠ ${gathered.priorityWarning}`);
    console.log(renderGatheredLoopStatusText(gathered));
    console.log(`batch: ${gathered.batch ?? "(none)"}`);
    if (gathered.receiptErrors.length > 0) {
        console.log(
            `\n${gathered.receiptErrors.length} receipt file(s) in the newest batch could not be read:`
        );
        for (const e of gathered.receiptErrors)
            console.log(`  ${e.file}: ${e.message}`);
    }
}

if (import.meta.main) {
    main();
}
