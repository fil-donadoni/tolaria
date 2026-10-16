#!/usr/bin/env bun
/**
 * `bun run post-merge <sync|seed> --before <sha> --after <sha>` — what a push
 * to the base obliges on a machine (issue #5644, PRD #5620). `post-merge.yml`
 * runs it from a job worktree on every machine; both steps act on the
 * machine's PRIMARY checkout, never on the worktree they run from.
 *
 *   sync   fetch + fast-forward the primary checkout (on the MacBook
 *          `convex dev` serves the deployment from it), remove the worktree
 *          each merged PR left standing, ingest the telemetry.
 *   seed   the `seed` machine only: fast-forward again (a no-op when `sync`
 *          already did), register each merged PR's `## Preset scenario`, and
 *          `seed:preset --all` when the push changed a card set.
 *
 * Every step is idempotent and runs even when an earlier one failed, except a
 * seed after a failed fast-forward (`seedPlan`). The exit code is 1 when any
 * step failed: in a job that is the red the owner sees — `land` hid the same
 * failures behind `; true` because a merge cannot be undone, a workflow can
 * simply be re-run.
 *
 * The decisions are `lib/post-merge.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import {
    mergedPrNumbers,
    mergedWorktree,
    pushRange,
    seedPlan,
} from "./lib/post-merge";
import { primaryCheckout } from "./lib/primary-checkout";

/** Wall for one child: a hung `convex` call must not hold the lane runner. */
const STEP_WALL_MS = 10 * 60_000;

function git(args: string[], cwd: string): { ok: boolean; out: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function bun(args: string[], cwd: string): boolean {
    const r = spawnSync("bun", args, {
        cwd,
        stdio: "inherit",
        timeout: STEP_WALL_MS,
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    });
    return r.status === 0;
}

/**
 * Fetch, then fast-forward the primary checkout — only when it has the base
 * branch checked out, and `--ff-only` on top: anything else would move a
 * branch of the owner's work in progress (the guard `land` always had).
 */
export function fastForward(primary: string): boolean {
    if (
        !git(["fetch", "--no-tags", "--quiet", "origin", BASE_BRANCH], primary)
            .ok
    ) {
        console.error("post-merge: could not fetch origin");
        return false;
    }
    const head = git(["symbolic-ref", "--quiet", "--short", "HEAD"], primary);
    if (head.out !== BASE_BRANCH) {
        console.error(
            `post-merge: ${primary} is on ${head.out || "a detached HEAD"}, not ${BASE_BRANCH} — left as it was`
        );
        return false;
    }
    if (!git(["merge", "--ff-only", "--quiet", ORIGIN_BASE], primary).ok) {
        console.error(
            `post-merge: could not fast-forward ${BASE_BRANCH} in ${primary} — pull it by hand`
        );
        return false;
    }
    return true;
}

/** Remove the worktree a merged PR's session left standing. */
function removeMergedWorktree(primary: string, pr: number): boolean {
    let head: string;
    try {
        head = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "headRefName",
            "--jq",
            ".headRefName",
        ]);
    } catch (e) {
        console.error(`post-merge: PR #${pr}: ${(e as Error).message}`);
        return false;
    }
    const wt = mergedWorktree(primary, head);
    if (wt === null) return true;
    if (!existsSync(wt)) {
        git(["worktree", "prune"], primary);
        return true;
    }
    const removed = git(["worktree", "remove", "--force", wt], primary).ok;
    console.log(
        `post-merge: PR #${pr}: worktree ${wt} ${removed ? "removed" : "NOT removed"}`
    );
    return removed;
}

function readPush(before: string, after: string, primary: string) {
    const range = pushRange(before, after);
    const subjects = git(
        ["log", "--reverse", "--format=%s", range],
        primary
    ).out.split("\n");
    const files = git(["diff", "--name-only", range], primary)
        .out.split("\n")
        .filter(Boolean);
    return { prs: mergedPrNumbers(subjects), files };
}

export function sync(primary: string, before: string, after: string): boolean {
    let ok = fastForward(primary);
    const { prs } = readPush(before, after, primary);
    for (const pr of prs) ok = removeMergedWorktree(primary, pr) && ok;
    ok = bun(["scripts/telemetry-ingest.ts", "--quick"], primary) && ok;
    return ok;
}

export function seed(primary: string, before: string, after: string): boolean {
    const ff = fastForward(primary);
    const { prs, files } = readPush(before, after, primary);
    const plan = seedPlan(ff, prs, files);
    if (!ff) return false;
    let ok = true;
    for (const pr of plan.scenarios)
        ok = bun(["scripts/seed-scenario.ts", String(pr)], primary) && ok;
    if (plan.presets)
        ok = bun(["scripts/seed-preset-deck.ts", "--all"], primary) && ok;
    return ok;
}

function flag(argv: string[], name: string): string {
    const i = argv.indexOf(name);
    const v = i === -1 ? undefined : argv[i + 1];
    if (!v)
        throw new Error(
            `usage: bun run post-merge <sync|seed> --before <sha> --after <sha> (missing ${name})`
        );
    return v;
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const step = argv[0];
    if (step !== "sync" && step !== "seed") {
        console.error(
            "usage: bun run post-merge <sync|seed> --before <sha> --after <sha>"
        );
        process.exit(2);
    }
    const primary = primaryCheckout();
    const run = step === "sync" ? sync : seed;
    process.exit(
        run(primary, flag(argv, "--before"), flag(argv, "--after")) ? 0 : 1
    );
}
