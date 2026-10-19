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
 * A PRIMARY THAT DIVERGED (issue #5873). Observed 2026-10-16: a `gaps:sync`
 * allowlist commit whose push lost a race stayed on the Huawei's primary, and
 * from then on every `sync` leg there failed, silently, for a day. Now the
 * fast-forward HEALS the one divergence that is the pipeline's own — local
 * commits that are all `gaps:sync` allowlist writes (`strandedAllowlistOnly`,
 * dropped with `reset --keep`; the next sync re-derives every number) — and
 * for any other divergence the leg goes red AND tells the owner through the
 * channel a RED uses (`lib/notify-owner.ts`), once per distinct failure
 * (`.claude/telemetry/post-merge/notice.json` beside the log remembers the
 * last one; a green leg clears it). What this leg cannot heal is the owner's
 * — nothing else on the machine depends on it: `housekeeping` and `nightly`
 * run on any lane runner and never touch the primary.
 *
 * The decisions are `lib/post-merge.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ALLOWLIST_PATH } from "./check-gaps";
import { ALLOWLIST_COMMIT_SUBJECT } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import { forgetNotice, notifyOnce } from "./lib/notify-owner";
import {
    mergedPrNumbers,
    cwdInside,
    mergedWorktree,
    pushRange,
    seedPlan,
    syncNotice,
} from "./lib/post-merge";
import { primaryCheckout } from "./lib/primary-checkout";

/** Wall for one child: a hung `convex` call must not hold the lane runner. */
const STEP_WALL_MS = 10 * 60_000;

/** Where the last notice sent for a red `sync` leg is remembered, relative
 *  to the primary checkout. */
export const NOTICE_FILE = join(
    ".claude",
    "telemetry",
    "post-merge",
    "notice.json"
);

function git(
    args: string[],
    cwd: string
): { ok: boolean; out: string; err: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return {
        ok: r.status === 0,
        out: (r.stdout ?? "").trim(),
        err: (r.stderr ?? "").trim(),
    };
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
 * The local commits a fast-forward refused on, when every one of them is a
 * `gaps:sync` allowlist write whose push lost a race — the one divergence
 * this script repairs (by dropping them: the next sync re-derives them).
 * Anything else, or nothing, is false. Pure.
 */
export function strandedAllowlistOnly(
    commits: ReadonlyArray<{ subject: string; files: string[] }>
): boolean {
    return (
        commits.length > 0 &&
        commits.every(
            (c) =>
                c.subject === ALLOWLIST_COMMIT_SUBJECT &&
                c.files.length === 1 &&
                c.files[0] === ALLOWLIST_PATH
        )
    );
}

/** The first non-blank line of git's stderr — its own reason. */
export function gitErrorLine(stderr: string): string {
    return (
        stderr
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l !== "") ?? "git printed no error"
    );
}

/**
 * Why a `merge --ff-only` was refused, for the red the owner reads (issue
 * #6018). "Diverged" only when HEAD really is not an ancestor of the base —
 * checked, never inferred from an empty local-commit list: a branch with no
 * commits of its own cannot diverge, and its refusal is git's (an untracked
 * file in the way, a dirty tree, a lock). Git's own line rides along always.
 * Pure.
 */
export function fastForwardRefusal(r: {
    gitError: string;
    headOnBase: boolean;
    local: ReadonlyArray<{ subject: string }>;
}): string {
    const why = `git: ${gitErrorLine(r.gitError)}`;
    if (r.headOnBase) return `no local commits, yet git refused (${why})`;
    const held =
        r.local.length === 0
            ? ""
            : `: it holds ${r.local.length} local commit(s) not on the base: ${r.local.map((c) => JSON.stringify(c.subject)).join(", ")}`;
    return `it diverged from the base${held} (${why})`;
}

/** The primary checkout's commits not on `origin/<base>`, with their files. */
export function localCommits(
    primary: string
): { subject: string; files: string[] }[] {
    const shas = git(["rev-list", `${ORIGIN_BASE}..HEAD`], primary).out;
    return shas === ""
        ? []
        : shas.split("\n").map((sha) => ({
              subject: git(["log", "-1", "--format=%s", sha], primary).out,
              files: git(
                  ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
                  primary
              ).out.split("\n"),
          }));
}

/**
 * Fetch, then fast-forward the primary checkout — only when it has the base
 * branch checked out, and `--ff-only` on top: anything else would move a
 * branch of the owner's work in progress (the guard `land` always had). A
 * refusal over stranded `gaps:sync` commits alone is healed (issue #5873):
 * they are dropped and the fast-forward retried.
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
    const merged = git(["merge", "--ff-only", "--quiet", ORIGIN_BASE], primary);
    if (merged.ok) return true;
    const local = localCommits(primary);
    if (strandedAllowlistOnly(local)) {
        if (
            git(["reset", "--keep", "--quiet", ORIGIN_BASE], primary).ok &&
            git(["merge", "--ff-only", "--quiet", ORIGIN_BASE], primary).ok
        ) {
            console.log(
                `post-merge: healed ${primary} — dropped ${local.length} stranded gaps:sync commit(s) (the next sync re-derives them)`
            );
            return true;
        }
        console.error(
            `post-merge: could not drop the stranded gaps:sync commit(s) in ${primary}`
        );
        return false;
    }
    console.error(
        `post-merge: could not fast-forward ${BASE_BRANCH} in ${primary} — ${fastForwardRefusal(
            {
                gitError: merged.err,
                headOnBase: git(
                    ["merge-base", "--is-ancestor", "HEAD", ORIGIN_BASE],
                    primary
                ).ok,
                local,
            }
        )} — pull it by hand`
    );
    return false;
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
    const cwds = spawnSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
        encoding: "utf8",
    }).stdout;
    if (cwdInside(cwds ?? "", wt)) {
        console.log(
            `post-merge: PR #${pr}: worktree ${wt} is in use (land?) — left to its owner`
        );
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

/** The failing steps of a `sync`, by name — what the owner's notice lists. */
export function syncSteps(
    primary: string,
    before: string,
    after: string
): string[] {
    const failed: string[] = [];
    if (!fastForward(primary)) failed.push(`fast-forward of ${primary}`);
    const { prs } = readPush(before, after, primary);
    for (const pr of prs)
        if (!removeMergedWorktree(primary, pr))
            failed.push(`worktree of PR #${pr}`);
    if (!bun(["scripts/telemetry-ingest.ts", "--quick"], primary))
        failed.push("telemetry ingest");
    return failed;
}

/** Tell the owner about a red leg — once per distinct failure; a green leg
 *  forgets the last notice. */
function notice(primary: string, failed: readonly string[]): void {
    const path = join(primary, NOTICE_FILE);
    const n = syncNotice(failed, hostname());
    if (n === null) {
        forgetNotice(path);
        return;
    }
    if (notifyOnce(path, n.key, n.message, "Tolaria post-merge"))
        console.log(`post-merge: notifying the owner: ${n.message}`);
}

export function sync(primary: string, before: string, after: string): boolean {
    const failed = syncSteps(primary, before, after);
    notice(primary, failed);
    return failed.length === 0;
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
