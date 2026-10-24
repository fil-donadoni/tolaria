#!/usr/bin/env bun
/**
 * The `merge=append-only` merge driver (issue #5942).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts`;
 * `.gitattributes` names it for the hand-written append-only lists in
 * `OTHER_MERGE_DRIVERS`. Without the registration git falls back to the default
 * text merge — the behaviour that predates the driver.
 *
 * It runs `git merge-file --diff3` and resolves only the hunks where both sides
 * inserted lines at the same point and neither touched an existing line
 * ({@link resolveAppendOnly}): ours, then theirs, each whole — or where both
 * sides only deleted distinct lines (issue #6648): what both kept. Any other hunk
 * stays a conflict and the driver exits 1, so a real disagreement still
 * reaches a human. The lane's `tsc` and tests judge every merged result.
 *
 * An add/add merge (empty base) is never resolved: with no ancestor the whole
 * file is one insertion per side, and concatenating two files is not a merge.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { writeStderrSync } from "./lib/merge-driver-io";
import {
    APPEND_ONLY_MARKER_SIZE,
    resolveAppendOnly,
} from "./lib/append-only-merge";

// git invokes a merge driver with cwd at the top of the working tree and
// substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    writeStderrSync(
        "merge-driver-append-only: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}
const label = path ?? ours;

const merged = spawnSync(
    "git",
    [
        "merge-file",
        "-p",
        "--diff3",
        `--marker-size=${APPEND_ONLY_MARKER_SIZE}`,
        "-L",
        "ours",
        "-L",
        "base",
        "-L",
        "theirs",
        ours,
        base,
        theirs,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
);
// merge-file exits with the number of conflicts (capped at 127), negative on
// error — spawnSync reports an error as a null status or a status above 127.
if (merged.status === null || merged.status > 127 || merged.error) {
    writeStderrSync(
        `merge-driver-append-only: git merge-file failed on ${label}: ${merged.stderr || String(merged.error)}\n`
    );
    process.exit(2);
}

if (readFileSync(base, "utf8") === "") {
    writeFileSync(ours, merged.stdout);
    process.exit(merged.status === 0 ? 0 : 1);
}

const { text, unresolved } = resolveAppendOnly(merged.stdout);
writeFileSync(ours, text);
if (unresolved > 0) {
    writeStderrSync(
        `merge-driver-append-only: ${label}: ${unresolved} conflict(s) edit existing lines — left for a human\n`
    );
    process.exit(1);
}
process.exit(0);
