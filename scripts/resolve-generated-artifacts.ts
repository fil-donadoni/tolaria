#!/usr/bin/env bun
/**
 * Regenerate the artifacts the `merge=regenerated` driver took a side of
 * (issue #3069) — the second half of "a generated artifact is regenerated,
 * not merged".
 *
 * Runs INSIDE `land`'s locked command, between the rebase and `check:lane`, so
 * the tree the lane gate sees is the tree a fresh regeneration produces. Safe
 * and near-free on every ordinary landing: with no marker it exits 0 without
 * touching anything.
 *
 * With no corpus cache it REFUSES rather than take a side — see
 * `planResolution` in `lib/generated-artifacts.ts` for why that is preferred
 * over leaning on the drift guard's red, which since issue #3070 would usually
 * also fire.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    CORPUS_CACHE_REL,
    planResolution,
    REGENERATE_MARKER,
} from "./lib/generated-artifacts";

const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function git(args: string[], cwd?: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
}

const root = git(["rev-parse", "--show-toplevel"]);
// `resolve`, never `join`: in a LINKED WORKTREE — the shape every issue branch
// is built in — `git rev-parse --git-path` returns an ABSOLUTE path into
// `<primary>/.git/worktrees/<name>/`, and `join(root, "/abs")` concatenates it
// into a path that does not exist. The resolver then finds no marker, exits 0,
// and the side-taken artifact sails past `check:lane` — the exact outcome this
// script exists to prevent (review of issue #3069).
const markerPath = resolve(
    root,
    git(["rev-parse", "--git-path", REGENERATE_MARKER])
);

if (!existsSync(markerPath)) process.exit(0);

// Read, but do NOT remove yet: the marker is a debt, and it is discharged by a
// regeneration, not by being looked at. A refusal below leaves it in place so
// the next `land` refuses again instead of quietly forgetting that a side was
// taken.
const markedPaths = readFileSync(markerPath, "utf8").split("\n");

const plan = planResolution({
    markedPaths,
    corpusPresent: existsSync(join(root, CORPUS_CACHE_REL)),
});

if (plan.kind === "none") {
    rmSync(markerPath, { force: true });
    process.exit(0);
}

if (plan.kind === "refuse") {
    process.stderr.write(
        `${RED}✗ resolve-generated-artifacts — ${plan.message}${RESET}\n`
    );
    process.exit(1);
}

for (const artifact of plan.artifacts) {
    process.stderr.write(
        `${DIM}resolve-generated-artifacts: regenerating ${artifact.path} (bun run ${artifact.script})${RESET}\n`
    );
    const r = spawnSync("bun", ["run", artifact.script], {
        cwd: root,
        stdio: "inherit",
    });
    if (r.status !== 0) {
        process.stderr.write(
            `${RED}✗ resolve-generated-artifacts — bun run ${artifact.script} failed; ${artifact.path} is NOT re-derived${RESET}\n`
        );
        process.exit(1);
    }
}

const paths = plan.artifacts.map((a) => a.path);
git(["add", "--", ...paths], root);
rmSync(markerPath, { force: true });

// Nothing staged means the side that was taken already WAS the regenerated
// content — a real outcome (both branches landed on the same bytes), and not
// one to amend an empty commit over.
const staged = spawnSync(
    "git",
    ["diff", "--cached", "--quiet", "--", ...paths],
    {
        cwd: root,
    }
);
if (staged.status === 0) {
    process.stderr.write(
        `${DIM}resolve-generated-artifacts: regeneration matched the merged side — nothing to amend${RESET}\n`
    );
    process.exit(0);
}

// `--no-verify`: the pre-commit hook runs lint-staged over a 39,000-line
// generated artifact, and the bytes here come from the generator, not a human.
git(["commit", "--amend", "--no-edit", "--no-verify"], root);
process.stderr.write(
    `resolve-generated-artifacts: re-derived ${paths.join(", ")} and amended the rebased tip\n`
);
