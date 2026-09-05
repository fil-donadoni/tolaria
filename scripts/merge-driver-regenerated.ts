#!/usr/bin/env bun
/**
 * The `merge=regenerated` merge driver (issue #3069).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts` — git merge
 * drivers cannot be committed, so the bootstrap is the only repo-controlled
 * place to install one. `.gitattributes` names it for every artifact in
 * {@link REGENERATED_ARTIFACTS}.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It first runs the ordinary 3-way merge (`git merge-file`). A clean result is
 * KEPT: two PRs adding disjoint card rows produce exactly the file a
 * regeneration would, and forcing a regenerate there would turn today's
 * clean merge into a refusal on any machine without the corpus cache.
 *
 * Only when that conflicts does it act: it restores OURS byte-for-byte (during
 * a rebase, "ours" is the branch being rebased ONTO — the same side the manual
 * procedure resolved to) and appends the path to a marker in the git dir. It
 * does NOT regenerate here: the driver runs once per replayed commit, mid-merge,
 * on a tree that is not yet the tree the artifact must be derived from, and the
 * compile it would have to run reads 34,890 corpus rows. Regeneration happens
 * ONCE, at the rebased tip, in `scripts/resolve-generated-artifacts.ts`.
 *
 * Exits 0 on a taken side ON PURPOSE: a non-zero exit is how a driver says
 * "conflict markers are in the file, a human must look", which is precisely the
 * manual resolution this exists to abolish. The safety net is the marker — the
 * resolver refuses to let a side-taken artifact reach `check:lane` unresolved.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGENERATE_MARKER } from "./lib/generated-artifacts";

// git invokes a merge driver with cwd at the top of the working tree and
// substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    process.stderr.write(
        "merge-driver-regenerated: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}
const label = path ?? ours;

// Keep a pristine copy of OURS: `git merge-file` writes its result — conflict
// markers included — into `ours` in place, so the fallback needs a copy taken
// before the attempt, not a re-read after it.
// `process.exit()` does not run `finally` blocks, so the scratch dir is torn
// down explicitly at each exit rather than wrapped in try/finally.
const scratch = mkdtempSync(join(tmpdir(), "tolaria-merge-"));
const oursBackup = join(scratch, "ours");

function done(code: number): never {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(code);
}

copyFileSync(ours, oursBackup);

const attempt = spawnSync(
    "git",
    [
        "merge-file",
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
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" }
);
if (attempt.status === 0) {
    // Clean 3-way merge — the ordinary case, and already correct.
    done(0);
}

copyFileSync(oursBackup, ours);

const markerPath = spawnSync(
    "git",
    ["rev-parse", "--git-path", REGENERATE_MARKER],
    { encoding: "utf8" }
);
if (markerPath.status !== 0) {
    // No marker means no safety net, and a silently side-taken artifact is the
    // exact failure this driver exists to prevent — so fail loudly and let git
    // report a conflict the operator can see.
    process.stderr.write(
        `merge-driver-regenerated: cannot locate the git dir to mark ${label} for regeneration\n`
    );
    done(1);
}
appendFileSync(markerPath.stdout.trim(), `${label}\n`);

process.stderr.write(
    `merge-driver-regenerated: ${label} carries whole-file state — took ours and marked it for regeneration ` +
        `(a generated artifact is regenerated, not merged — issue #3069)\n`
);
done(0);
