#!/usr/bin/env bun
// `bun run queue:train` — print the merge-train plan for a batch, from the
// receipts on disk (issues #2185/#2186, PRD #2180).
//
// This wrapper holds NO decisions. It reads the batch's receipt artifacts,
// calls `computeTrainOrder`, and prints. The ordering rules live in
// `lib/train-order.ts` where they are pure and tested — a rule re-implemented
// here would be untested again, which is the whole failure this PRD is undoing.
//
// Usage:
//   bun run queue:train --batch <session-id>      # the batch's receipt dir
//   bun run queue:train --batch <id> --pretty
//   bun run queue:train --dir <path>              # explicit dir, for a resume
//
// Output shape:
//   {
//     order:   [2190, 2187],        // merge in THIS sequence
//     cycles:  [],                  // non-empty ⇒ order is [] and the batch stops
//     edges:   [{before, after, path}],
//     entries: [{issue, pr, branch, worktree, verdict, findings, scenario, ...}],
//     missing: 0                    // subagents that stopped leaving no receipt
//   }
//
// `entries` is the join the orchestrator would otherwise perform by holding
// every receipt in its context: for each mergeable issue, the one PR number,
// the branch, the worktree, the review verdict, and whether a debug-scenario
// spec is waiting to be registered post-merge. Reading a field from here costs
// nothing; carrying the receipts costs the whole run.

import * as path from "path";
import {
    RECEIPTS_ROOT,
    readReceipts,
    type MissingReceipt,
    type Receipt,
    type ReviewReceipt,
    type WorkReceipt,
} from "./lib/receipt";
import { computeTrainOrder, latestWorkReceipts } from "./lib/train-order";

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

const pretty = process.argv.includes("--pretty");
const batch = flag("batch");
const dir = flag("dir");

if (!batch && !dir) {
    console.error(
        `usage: bun run queue:train --batch <session-id> [--pretty]\n` +
            `       bun run queue:train --dir <receipt-dir> [--pretty]\n\n` +
            `Receipts live under ${RECEIPTS_ROOT}/<session-id>/.`
    );
    process.exit(2);
}

const root = process.cwd();
let receipts: Receipt[];
try {
    receipts = dir
        ? readReceipts(path.dirname(path.resolve(dir)), path.basename(dir))
        : readReceipts(root, batch!);
} catch (error) {
    // A corrupt receipt stops the train rather than being skipped: a batch
    // silently short one PR looks exactly like a batch that was always that
    // size, and the missing merge surfaces as a stale claim days later.
    console.error(
        `receipt read failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
}

const work = receipts.filter(
    (r): r is WorkReceipt => r.role === "implement" || r.role === "fixup"
);
const reviews = new Map<number, ReviewReceipt>(
    receipts
        .filter((r): r is ReviewReceipt => r.role === "review")
        .map((r) => [r.issue, r])
);
const missing = receipts.filter(
    (r): r is MissingReceipt => r.role === "missing"
).length;

// A fixup receipt supersedes the implement receipt for the same issue — it
// describes the branch as it will actually land.
const ordered = latestWorkReceipts(work);

const plan = computeTrainOrder(ordered);

const entries = ordered
    .filter((r) => r.outcome === "pr-open")
    .map((r) => ({
        issue: r.issue,
        pr: r.pr,
        branch: r.branch,
        worktree: r.worktree,
        targetFiles: r.targetFiles,
        restructures: r.restructures ?? [],
        verdict: reviews.get(r.issue)?.outcome ?? null,
        findings: reviews.get(r.issue)?.findings ?? [],
        scenario: r.scenario ?? null,
    }));

const blocked = ordered
    .filter((r) => r.outcome !== "pr-open")
    .map((r) => ({ issue: r.issue, outcome: r.outcome, reason: r.reason }));

console.log(
    JSON.stringify(
        { ...plan, entries, blocked, missing },
        null,
        pretty ? 2 : undefined
    )
);
