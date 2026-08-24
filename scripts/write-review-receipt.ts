#!/usr/bin/env bun
// `bun run review:receipt` — the reviewer subagent's ONLY way to write a
// verdict receipt.
//
// Issue #2285: `reviewer-brief.md` used to describe the receipt's FIELDS in
// prose (`role: "review"`, `outcome: "approve" | "blocking"`, `pr`,
// `findings[]`) and left the reviewer to hand-author the JSON. In the one
// batch that surfaced this, 4/4 hand-written review receipts were malformed —
// missing `version`, or `findings` written as `{ id, severity, ... }` objects
// instead of strings — and `readReceipts` parses a batch directory eagerly,
// so ONE malformed receipt made `queue:train` refuse to plan the whole batch.
// Meanwhile 4/4 implement/fixup receipts, governed by `subagent-brief.md`,
// were valid — not because that brief's prose is better, but because an
// implement subagent is already writing TypeScript to do its job and a
// reviewer is not.
//
// Naming `writeReceipt` in prose a second time would repeat the same failure:
// a sentence is not a validator, and a reviewer satisfying the sentence can
// still produce something `parseReceipt` rejects. So the reviewer gets a
// callable entry point instead of a field list to transcribe. This script
// builds the object and calls `writeReceipt` (`scripts/lib/receipt.ts`)
// itself — there is no path through this CLI that reaches `parseReceipt` with
// a missing `version` (the module's `RECEIPT_VERSION` is stamped here, not
// retyped) or with `findings` as anything but `string[]` (the caller only
// ever supplies `--finding "<one line>"`, repeated).
//
// Usage:
//   bun run review:receipt --batch <BATCH_ID> --issue <N> --pr <N> --outcome approve
//   bun run review:receipt --batch <BATCH_ID> --issue <N> --pr <N> --outcome blocking \
//       --finding "convex/gre/search.ts:709 (medium) — one line per finding" \
//       --finding "another finding, one prose line each"
//   bun run review:receipt --batch <BATCH_ID> --issue <N> --pr <N> --outcome approve --round 2
//
// Prints the path written and exits 0. A malformed call — a bad `--outcome`,
// a `blocking` verdict with no `--finding`, a round that collides with a
// receipt already on disk — throws and exits non-zero with the same message
// `writeReceipt`/`parseReceipt` would give a hand-written caller, so a bad
// call is loud rather than a silently-accepted file.

import { RECEIPT_VERSION, writeReceipt } from "./lib/receipt";
import { primaryCheckout } from "./lib/primary-checkout";

function readFlag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = process.argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} needs a value`);
    }
    return value;
}

function readAllFlags(name: string): string[] {
    const values: string[] = [];
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === `--${name}`) {
            const value = process.argv[i + 1];
            if (value === undefined || value.startsWith("--")) {
                throw new Error(`--${name} needs a value`);
            }
            values.push(value);
        }
    }
    return values;
}

function requireFlag(name: string): string {
    const value = readFlag(name);
    if (value === undefined) {
        throw new Error(`--${name} is required`);
    }
    return value;
}

function requirePositiveInt(name: string): number {
    const raw = requireFlag(name);
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--${name} must be a positive integer, got "${raw}"`);
    }
    return value;
}

const batch = requireFlag("batch");
const issue = requirePositiveInt("issue");
const pr = requirePositiveInt("pr");
const outcome = requireFlag("outcome");
if (outcome !== "approve" && outcome !== "blocking") {
    throw new Error(
        `--outcome must be "approve" or "blocking", got "${outcome}"`
    );
}
const findings = readAllFlags("finding");
const roundRaw = readFlag("round");
const round = roundRaw === undefined ? undefined : requirePositiveInt("round");

const receipt: Record<string, unknown> = {
    version: RECEIPT_VERSION,
    role: "review",
    issue,
    outcome,
    pr,
    findings,
    ...(round === undefined ? {} : { round }),
};

// writeReceipt validates via parseReceipt before it writes — including the
// "blocking with zero findings" rejection — so that rule lives once, in the
// contract, not re-implemented here.
//
// The project root is the PRIMARY checkout, not `process.cwd()` (issue
// #2656): every reviewer subagent runs this from inside its own issue
// worktree, so a bare `process.cwd()` wrote the receipt to a sibling
// directory the merge-train never reads — silently, since the write itself
// succeeded and printed a path.
const written = writeReceipt(primaryCheckout(), batch, receipt);
console.log(written);
