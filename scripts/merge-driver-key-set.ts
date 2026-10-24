#!/usr/bin/env bun
/**
 * The `merge=key-set` merge driver (issue #6276).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts`;
 * `.gitattributes` names it for the files `OTHER_MERGE_DRIVERS` gives it. It
 * merges the three sides as a sorted set of keys ({@link mergeKeySets}), or of
 * rows keyed by `name` ({@link mergeKeyedRows}, issue #6648), and writes the
 * canonical form, so removals and additions never conflict.
 *
 * Exits non-zero when a side does not parse — a malformed file must reach a
 * human, not be merged into a plausible-looking one — or when both sides
 * changed one keyed row differently.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { writeStderrSync } from "./lib/merge-driver-io";
import { mergeKeySetFile } from "./lib/key-set-merge";

// git substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    writeStderrSync(
        "merge-driver-key-set: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}

const merged = mergeKeySetFile(
    readFileSync(base, "utf8"),
    readFileSync(ours, "utf8"),
    readFileSync(theirs, "utf8")
);
if (!merged.ok) {
    writeStderrSync(
        `merge-driver-key-set: ${path ?? ours}: ${merged.error} — resolve it by hand\n`
    );
    process.exit(1);
}
writeFileSync(ours, merged.text);
process.exit(0);
