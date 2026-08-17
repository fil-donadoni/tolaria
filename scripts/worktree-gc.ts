#!/usr/bin/env bun
/**
 * `bun run wt:gc` — report (and, with `--yes`, remove) worktrees that have
 * finished their job.
 *
 * WHY. 31 worktrees had accumulated in this checkout by 2026-08-17, some weeks
 * old, several sitting on branches already merged into `main`. Two costs, and
 * the second is the expensive one:
 *
 *   - disk: a bootstrapped worktree carries its own `node_modules`.
 *   - FALSE COLLISIONS: `/process-gh-issues` decides an issue belongs to
 *     another session by finding its branch or worktree (§1b). An abandoned
 *     `tolaria-issue-1851` therefore makes issue #1851 look permanently claimed,
 *     and it is skipped by every pass from then on. Nothing reports this — the
 *     issue simply stops being selected.
 *
 * The Release step of a pass is supposed to tear its own worktree down. It does
 * not run when a pass dies mid-flight (a headless pass that ends its turn
 * waiting on a background job leaves claims AND worktrees behind), which is
 * precisely when cleanup is needed most. So this is a sweeper, not a substitute
 * for Release.
 *
 * SAFE BY DEFAULT: prints and removes nothing. `--yes` removes only what it
 * classifies as finished; anything with uncommitted work, or with commits not
 * yet in `origin/main`, is kept and listed with the reason.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export type WorktreeFacts = {
    path: string;
    branch: string | null;
    /** Uncommitted changes in the tree. */
    dirty: boolean;
    /** Commits on this branch that are not in origin/main. */
    unmerged: number;
    locked: boolean;
};

export type Verdict =
    | { action: "remove"; reason: string }
    | { action: "keep"; reason: string };

/**
 * Pure so the destructive decision is testable without building 31 worktrees.
 *
 * The ONLY removable shape is: clean tree, and nothing on it that `origin/main`
 * does not already have. Everything else is somebody's unfinished work — an
 * abandoned worktree costs disk, a deleted one costs the work.
 */
export function classify(w: WorktreeFacts): Verdict {
    if (w.locked) return { action: "keep", reason: "locked" };
    if (w.dirty) return { action: "keep", reason: "uncommitted changes" };
    if (w.unmerged > 0) {
        return {
            action: "keep",
            reason: `${w.unmerged} commit(s) not in origin/main`,
        };
    }
    if (w.branch === null) {
        return { action: "remove", reason: "detached, nothing unmerged" };
    }
    return { action: "remove", reason: "merged, clean" };
}

// Same trap as the docs lane: bun auto-loads `.env.local`, whose GITHUB_TOKEN
// shadows the gh keyring and 403s every network call.
const NET_ENV: NodeJS.ProcessEnv = (() => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
})();

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd, env: NET_ENV });
    return r.status === 0 ? r.stdout.trim() : "";
}

/** Parse `git worktree list --porcelain` into records. */
export function parseWorktreeList(porcelain: string): {
    path: string;
    branch: string | null;
    locked: boolean;
}[] {
    const out: { path: string; branch: string | null; locked: boolean }[] = [];
    let current: {
        path: string;
        branch: string | null;
        locked: boolean;
    } | null = null;
    for (const line of porcelain.split("\n")) {
        if (line.startsWith("worktree ")) {
            if (current) out.push(current);
            current = {
                path: line.slice("worktree ".length),
                branch: null,
                locked: false,
            };
        } else if (line.startsWith("branch ") && current) {
            current.branch = line.slice("branch refs/heads/".length);
        } else if (line === "locked" && current) {
            current.locked = true;
        }
    }
    if (current) out.push(current);
    return out;
}

if (import.meta.main) {
    const apply = process.argv.includes("--yes");
    const cwd = process.cwd();
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    const primary = common.startsWith("/") ? dirname(resolve(common)) : cwd;

    git(["fetch", "origin", "main", "-q"], primary);
    const entries = parseWorktreeList(
        git(["worktree", "list", "--porcelain"], primary)
    ).filter((w) => resolve(w.path) !== resolve(primary));

    const removable: string[] = [];
    for (const e of entries) {
        const dirty = git(["status", "--porcelain"], e.path) !== "";
        const unmergedOut = git(
            ["rev-list", "--count", "origin/main..HEAD"],
            e.path
        );
        const facts: WorktreeFacts = {
            ...e,
            dirty,
            unmerged: Number(unmergedOut || "0"),
        };
        const v = classify(facts);
        const mark = v.action === "remove" ? "×" : "·";
        console.log(
            `  ${mark} ${e.path.replace(dirname(primary) + "/", "")}` +
                `  [${e.branch ?? "detached"}]  ${v.reason}`
        );
        if (v.action === "remove") removable.push(e.path);
    }

    console.log(
        `\n${entries.length} worktree(s), ${removable.length} finished.`
    );
    if (removable.length === 0) process.exit(0);
    if (!apply) {
        console.log("Nothing removed — re-run with --yes to remove them.");
        process.exit(0);
    }
    for (const p of removable) {
        const ok = spawnSync("git", ["worktree", "remove", p], {
            stdio: "inherit",
            cwd: primary,
            env: NET_ENV,
        }).status;
        console.log(`${ok === 0 ? "removed" : "FAILED"}  ${p}`);
    }
}
