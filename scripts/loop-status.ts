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
import { fetchBoardPriority, type BoardPriority } from "./lib/board-priority";
import {
    newestBatchDir,
    readReceiptsFromDir,
    RECEIPTS_ROOT,
    type ReceiptFileError,
} from "./lib/receipt";
import { parseWorktreeList } from "./worktree-gc";
import {
    fetchAllBranchNames,
    fetchClaimedIssues,
    fetchOpenPrBranches,
} from "./loop-doctor";
import {
    approvedReviewIssues,
    buildLoopStatus,
    readDriverState,
    renderLoopStatusText,
    worktreeIssueNumbers,
    type LoopStatus,
    type ReadyQueueIssue,
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

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";
const PROJECT_ITEM_LIMIT = 2000;

/**
 * `loop:status` is READ-ONLY observability, not a scheduling decision — a
 * missing `read:project` scope here must not crash the whole view the way
 * `queue:plan`'s `die()` deliberately does (there, a wrong sort silently
 * mis-orders real work; here, a missing priority column is cosmetic).
 * Degrade gracefully: priorities render as unknown, print ONE warning line.
 */
function fetchPriorityGracefully(noPriority: boolean): {
    priority: Record<number, BoardPriority>;
    warning: string | null;
} {
    let warning: string | null = null;
    const priority = fetchBoardPriority({
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
        itemLimit: PROJECT_ITEM_LIMIT,
        skip: noPriority,
        onError: (message) => {
            warning ??= message.split("\n")[0]!;
        },
    });
    return { priority, warning };
}

/** Ready-for-agent issues with no `in-progress` label — the unclaimed queue. */
function fetchUnclaimedReadyQueue(): ReadyQueueIssue[] {
    const raw = JSON.parse(
        gh([
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

export interface GatherLoopStatusOptions {
    noPriority?: boolean;
}

export interface GatheredLoopStatus extends LoopStatus {
    batch: string | null;
    priorityWarning: string | null;
    receiptErrors: ReceiptFileError[];
}

/**
 * All the impure gathering (`gh`, `git`, and the primary checkout's
 * `.claude/telemetry` + `.claude/receipts`), then `buildLoopStatus`. The one
 * function both the CLI (`main`, below) and `telemetry-serve.ts`'s
 * `/api/loop-status` route call — the join happens exactly once.
 */
export function gatherLoopStatus(
    opts: GatherLoopStatusOptions = {}
): GatheredLoopStatus {
    const primary = primaryCheckout();
    const telemetryDir = path.join(primary, ".claude", "telemetry");
    const receiptsRoot = path.join(primary, RECEIPTS_ROOT);

    const claimedIssues = fetchClaimedIssues();
    const prBranches = fetchOpenPrBranches();
    const allBranches = fetchAllBranchNames();

    const worktreePorcelain = sh(
        "git",
        ["worktree", "list", "--porcelain"],
        primary
    );
    const worktrees = parseWorktreeList(worktreePorcelain);

    const readyQueueIssues = fetchUnclaimedReadyQueue();
    const { priority, warning } = fetchPriorityGracefully(
        opts.noPriority ?? false
    );

    const batch = newestBatchDir(receiptsRoot);
    const { receipts, errors } = batch
        ? readReceiptsFromDir(path.join(receiptsRoot, batch))
        : { receipts: [], errors: [] };

    const driver = readDriverState({ telemetryDir });

    const status = buildLoopStatus({
        claimedIssues,
        prBranches,
        allBranches,
        worktreeIssueNumbers: worktreeIssueNumbers(worktrees),
        approvedReviewIssues: approvedReviewIssues(receipts),
        priority,
        readyQueueIssues,
        receipts,
        driver,
    });

    return {
        ...status,
        batch: batch ?? null,
        priorityWarning: warning,
        receiptErrors: errors,
    };
}

function main(): void {
    const asJson = process.argv.includes("--json");
    const noPriority = process.argv.includes("--no-priority");

    const gathered = gatherLoopStatus({ noPriority });

    if (asJson) {
        console.log(JSON.stringify(gathered, null, 2));
        return;
    }

    if (gathered.priorityWarning)
        console.error(`⚠ ${gathered.priorityWarning}`);
    console.log(renderLoopStatusText(gathered));
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
