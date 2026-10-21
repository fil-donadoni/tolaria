#!/usr/bin/env bun
/**
 * The `merge=key-set` merge driver (issue #6276).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts`;
 * `.gitattributes` names it for the issue-log ratchet baseline. It merges the
 * three sides as a sorted set of keys ({@link mergeKeySets}) and writes the
 * canonical form, so removals and additions never conflict.
 *
 * Exits non-zero only when a side does not parse: a malformed baseline must
 * reach a human, not be merged into a plausible-looking file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { writeStderrSync } from "./lib/merge-driver-io";
import { mergeKeySets, serializeKeys } from "./lib/key-set-merge";

// git substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    writeStderrSync(
        "merge-driver-key-set: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}

const merged = mergeKeySets(
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
writeFileSync(ours, serializeKeys(merged.keys));
process.exit(0);
