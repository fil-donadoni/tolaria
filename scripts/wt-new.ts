#!/usr/bin/env bun
// `bun run wt:new <issue#> [--fix]` — the issue worktree, branched from the
// REMOTE base tip (ADR 0116).
//
// `git worktree add ../tolaria-issue-N -b feat/issue-N` branches from
// wherever the primary checkout happens to be — the RELEASE branch, since
// that is what the primary keeps checked out — so every issue would start
// behind the base branch by however many landings the last release is
// missing, and rebase conflicts get manufactured out of nothing. This
// script fetches `origin/<base>` and branches from THAT, then runs the
// bootstrap. The base branch name comes from tolaria.config.json; nothing
// here names one.
//
// Prints the worktree path on its last line, so a caller can `cd "$(…)"`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/** Branch and worktree names for an issue — pure, for the test. */
export function issueWorktree(
    primary: string,
    issue: number,
    kind: "feat" | "fix"
): { branch: string; worktree: string } {
    return {
        branch: `${kind}/issue-${issue}`,
        worktree: resolve(
            dirname(primary),
            `${basename(primary)}-issue-${issue}`
        ),
    };
}

function main(): void {
    const argv = process.argv.slice(2);
    const issue = Number(
        (argv.find((a) => !a.startsWith("--")) ?? "").replace(/^#/, "")
    );
    if (!Number.isInteger(issue) || issue <= 0) {
        console.error("usage: bun run wt:new <issue#> [--fix]");
        process.exit(2);
    }
    const kind = argv.includes("--fix") ? "fix" : "feat";
    const cwd = process.cwd();
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    const primary = common.startsWith("/") ? dirname(resolve(common)) : cwd;
    const { branch, worktree } = issueWorktree(primary, issue, kind);

    if (existsSync(worktree)) {
        console.error(`wt:new: ${worktree} already exists`);
        console.log(worktree);
        return;
    }
    git(["fetch", "origin", BASE_BRANCH, "-q"], primary);
    git(["worktree", "add", worktree, "-b", branch, ORIGIN_BASE], primary);
    const init = spawnSync("bun", ["run", "worktree:init"], {
        stdio: "inherit",
        cwd: worktree,
    });
    if (init.status !== 0) {
        console.error(
            "wt:new: worktree:init failed — the worktree is left in place"
        );
        process.exit(init.status ?? 1);
    }
    console.error(`wt:new: ${branch} branched from ${ORIGIN_BASE}`);
    console.log(worktree);
}

if (import.meta.main) {
    main();
}
