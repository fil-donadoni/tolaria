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
//
// A worktree is a session about to work, so the MACHINE is asked first (issue
// #4966): the same decision `queue:claim` gets
// (`lib/machine-admission.ts`). Refused → exit 1, nothing created; the
// announced, logged escape is `TOLARIA_OVER_CAP=1`.
//
// `--resume` (issue #4763): the worktree of a STRANDED claim — a dead pass's
// pushed branch, not a fresh one. Checks out `feat|fix/issue-N` (the local
// branch when it exists, else the remote one) instead of branching from base.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { issueWorktree, pickResumeBranch } from "./lib/issue-worktree";
import {
    OVER_CAP_ENV,
    admitSessionNow,
    logSessionAdmission,
    sessionRefusal,
} from "./lib/machine-admission";

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function main(): void {
    const argv = process.argv.slice(2);
    const issue = Number(
        (argv.find((a) => !a.startsWith("--")) ?? "").replace(/^#/, "")
    );
    if (!Number.isInteger(issue) || issue <= 0) {
        console.error("usage: bun run wt:new <issue#> [--fix] [--resume]");
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
    const machine = admitSessionNow({
        override: process.env[OVER_CAP_ENV] === "1",
        cwd: primary,
    });
    if (
        machine.decision.verdict === "refuse" ||
        machine.decision.overridden.length > 0
    )
        logSessionAdmission(
            process.env.CLAUDE_PROJECT_DIR ?? primary,
            machine,
            {
                source: `wt:new #${issue}`,
            }
        );
    if (machine.decision.verdict === "refuse") {
        console.error(
            `✗ wt:new: ${sessionRefusal(machine.decision.reasons, machine.census?.others ?? [])}`
        );
        process.exit(1);
    }
    if (machine.decision.overridden.length > 0)
        console.error(
            `wt:new: machine admission OVERRIDDEN (${OVER_CAP_ENV}=1) — ${machine.decision.overridden.join("; ")}`
        );
    if (argv.includes("--resume")) {
        // A dead worktree's directory may be gone while git still lists it.
        git(["worktree", "prune"], primary);
        const local = git(
            ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
            primary
        ).split("\n");
        const remote = git(
            ["ls-remote", "--heads", "origin", `*issue-${issue}`],
            primary
        )
            .split("\n")
            .map((l) => l.split("\t")[1]?.replace(/^refs\/heads\//, ""))
            .filter((b): b is string => Boolean(b));
        const pick = pickResumeBranch(issue, local, remote);
        if (!pick) {
            console.error(
                `wt:new --resume: no feat|fix/issue-${issue} branch, local or on origin — nothing to resume`
            );
            process.exit(1);
        }
        try {
            if (pick.from === "local") {
                // A local branch BEHIND its pushed head (the PR moved after
                // the dead pass's last fetch) is fast-forwarded first, or
                // the resume works on stale code and its push is rejected.
                // Diverged = local holds unpushed commits: keep it, say so.
                if (remote.includes(pick.branch)) {
                    git(["fetch", "origin", pick.branch, "-q"], primary);
                    const behind =
                        spawnSync(
                            "git",
                            [
                                "merge-base",
                                "--is-ancestor",
                                pick.branch,
                                `origin/${pick.branch}`,
                            ],
                            { cwd: primary }
                        ).status === 0;
                    if (behind)
                        git(
                            [
                                "branch",
                                "-f",
                                pick.branch,
                                `origin/${pick.branch}`,
                            ],
                            primary
                        );
                    else
                        console.error(
                            `wt:new --resume: local ${pick.branch} has commits origin/${pick.branch} lacks — resuming the LOCAL branch`
                        );
                }
                git(["worktree", "add", worktree, pick.branch], primary);
            } else {
                git(["fetch", "origin", pick.branch, "-q"], primary);
                git(
                    [
                        "worktree",
                        "add",
                        worktree,
                        "-b",
                        pick.branch,
                        `origin/${pick.branch}`,
                    ],
                    primary
                );
            }
        } catch (err) {
            // The usual cause: the branch is still checked out in another
            // worktree at a different path (`git worktree list` names it).
            console.error(
                `wt:new --resume: could not check out ${pick.branch} — ${(err as Error).message}\n` +
                    `  If another worktree holds it, \`git worktree list\` names it: resume there.`
            );
            process.exit(1);
        }
    } else {
        git(["fetch", "origin", BASE_BRANCH, "-q"], primary);
        git(["worktree", "add", worktree, "-b", branch, ORIGIN_BASE], primary);
    }
    // Bootstrap chatter goes to STDERR: stdout carries the path and nothing
    // else, so `cd "$(bun run --silent wt:new N)"` works.
    const init = spawnSync("bun", ["run", "worktree:init"], {
        stdio: ["ignore", 2, 2],
        cwd: worktree,
    });
    if (init.status !== 0) {
        console.error(
            "wt:new: worktree:init failed — the worktree is left in place"
        );
        process.exit(init.status ?? 1);
    }
    console.error(
        argv.includes("--resume")
            ? `wt:new: resumed the dead pass's branch for issue #${issue}`
            : `wt:new: ${branch} branched from ${ORIGIN_BASE}`
    );
    console.log(worktree);
}

if (import.meta.main) {
    main();
}
