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
    readReceiptsFromDir,
    type MissingReceipt,
    type Receipt,
    type ReceiptFileError,
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

// `--dir` names the receipt directory ITSELF (e.g. `.claude/receipts/<batch>`,
// the same path §"Resuming an interrupted train" tells an orchestrator to
// re-point at). The old code ran it through `readReceipts(projectRoot,
// batchId)`, which always re-appends RECEIPTS_ROOT — so an already-complete
// path resolved to `.claude/receipts/.claude/receipts/<batch>`, found
// nothing, and printed an empty plan with exit 0. A resuming orchestrator
// reads that as "this batch has nothing to merge" rather than "you passed
// the wrong shape of path". `readReceiptsFromDir` reads the directory
// exactly as given — no RECEIPTS_ROOT join — so `--dir` and `--batch` land on
// the same files for the same batch.
let receipts: Receipt[];
let readErrors: ReceiptFileError[];
if (dir) {
    const resolved = path.resolve(dir);
    ({ receipts, errors: readErrors } = readReceiptsFromDir(resolved));
    if (receipts.length === 0 && readErrors.length === 0) {
        console.error(
            `receipt read failed: --dir ${dir} (resolved ${resolved}) holds no receipts`
        );
        process.exit(1);
    }
} else {
    ({ receipts, errors: readErrors } = readReceipts(root, batch!));
}

// A malformed or tampered receipt quarantines its OWN issue rather than the
// batch: every issue named by an error is excluded from the plan below, but
// every issue whose receipts are sound still gets an order. `readReceipts`
// never throws for this reason — it hands back the errors so this quarantine
// can happen, instead of the old behaviour where the first corrupt file made
// `exit 1` for every PR in the pass.
const quarantined = new Set(
    readErrors.map((e) => e.issue).filter((n): n is number => n !== undefined)
);
const unreadable = readErrors.map((e) => ({
    file: e.file,
    message: e.message,
}));

const usable = receipts.filter((r) =>
    r.role === "missing" ? true : !quarantined.has(r.issue)
);

const work = usable.filter(
    (r): r is WorkReceipt => r.role === "implement" || r.role === "fixup"
);

// Review verdicts are selected by ROUND, not by iteration order over
// filename-sorted disk reads — `12-review-2.json` sorts BEFORE
// `12-review.json`, so a naive last-wins-by-iteration map let a superseded
// round-1 blocking verdict beat the round-2 approve that supersedes it.
const reviews = new Map<number, ReviewReceipt>();
for (const r of usable) {
    if (r.role !== "review") continue;
    const held = reviews.get(r.issue);
    if (!held || (r.round ?? 1) > (held.round ?? 1)) {
        reviews.set(r.issue, r);
    }
}

const missing = usable.filter(
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
        { ...plan, entries, blocked, missing, unreadable },
        null,
        pretty ? 2 : undefined
    )
);

// Non-zero whenever anything was unreadable — a pass cannot silently ship a
// short batch. The plan above still printed every issue that WAS readable,
// so a caller that only cares about `order` can still merge those; a caller
// that checks exit code (every automated one) is stopped and shown why.
if (unreadable.length > 0) {
    for (const u of unreadable) {
        console.error(`receipt unreadable: ${u.file}: ${u.message}`);
    }
    process.exit(1);
}
