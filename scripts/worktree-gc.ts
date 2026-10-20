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
 *
 * `--issues-only` limits the run to `feat|fix/issue-N` worktrees: the form
 * `post-merge sweep` runs hourly on every machine (issue #6083), so a worktree
 * whose PR was closed unmerged, or whose pass died before opening one, goes
 * too — once nothing on it exists only on this disk.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { worktreeQuietMinutes, type ShRunner } from "./loop-doctor";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { CLAIM_LABEL, PR_OPEN_LABEL } from "./lib/claim-labels";
import { issueOfBranch } from "./lib/issue-worktree";
import { defaultCwdProbe, unpushedOnWorktree } from "./lib/orphan-worktree";

export type WorktreeFacts = {
    path: string;
    branch: string | null;
    /** Uncommitted changes in the tree. */
    dirty: boolean;
    /** Commits on this branch that are not in origin/main. */
    unmerged: number;
    locked: boolean;
    /** A live process has its cwd inside the tree; `null` = could not tell. */
    inUse: boolean | null;
    /** This branch is the head of a MERGED pull request. */
    mergedPr?: boolean;
    /** This branch is the head of an OPEN pull request. */
    openPr?: boolean;
    /** This branch is the head of a pull request CLOSED without merging. */
    closedPr?: boolean;
    /**
     * Commits on the branch absent from the base AND from `origin/<branch>`
     * — work that exists only on this disk. `null` = unreadable.
     */
    unpushed: number | null;
    /** Issue worktrees: the issue carries an `in-progress` claim. `null` =
     *  unreadable. */
    liveClaim?: boolean | null;
    /** Minutes since the tree last changed; `null` = unreadable. */
    idleMinutes?: number | null;
};

export type Verdict =
    | { action: "remove"; reason: string }
    | { action: "keep"; reason: string };

/** How long an issue worktree with no PR and no claim must sit untouched
 *  before the sweep removes it (issue #6083). */
export const ORPHAN_IDLE_MINUTES = 24 * 60;

/** A `feat|fix/issue-N` branch — a worktree `wt:new` made for an issue. */
export function isIssueBranch(branch: string | null): branch is string {
    return (
        branch !== null &&
        /^(feat|fix)\//.test(branch) &&
        issueOfBranch(branch) !== null
    );
}

/**
 * Pure so the destructive decision is testable without building 31 worktrees.
 *
 * Removable means: nobody inside it, not locked, clean tree, and nothing on
 * it that exists only on this disk. Everything else is somebody's unfinished
 * work — an abandoned worktree costs disk, a deleted one costs the work.
 * `git worktree remove` deletes the working directory, never the branch, and
 * nothing here touches the remote branch.
 */
export function classify(w: WorktreeFacts): Verdict {
    if (w.locked) return { action: "keep", reason: "locked" };
    if (w.inUse === true)
        return { action: "keep", reason: "a process has its cwd inside it" };
    if (w.inUse === null)
        return {
            action: "keep",
            reason: "the processes inside it could not be listed",
        };
    if (w.dirty) return { action: "keep", reason: "uncommitted changes" };
    if (w.openPr) return { action: "keep", reason: "PR still open" };
    // A claimed issue worktree is a session's, even on a branch an earlier PR
    // merged from (a reopened issue resumed on `fix/issue-N`).
    if (isIssueBranch(w.branch) && w.liveClaim === true)
        return { action: "keep", reason: "issue claimed (in-progress)" };

    // A SQUASH merge — which is how every PR lands here — puts the branch's
    // CONTENT into main under a brand-new commit. The branch's own commit is
    // therefore never an ancestor of main, and the ancestry count below reads
    // `1 commit not in origin/main` forever. That made the first version of
    // this tool report almost nothing as finished: of 36 worktrees it found
    // 10, and every one of the 26 it kept had just been merged.
    //
    // The PR's own verdict is the authority on merged-ness, not ancestry.
    //
    // Kept deliberately ahead of the unmerged count, so a branch that gained
    // commits AFTER its PR merged is still removable: `git worktree remove`
    // deletes the working directory, never the branch, so those commits stay
    // reachable and nothing is lost.
    if (w.mergedPr) return { action: "remove", reason: "PR merged" };

    // An issue worktree no merge will ever clean up (issue #6083): its PR was
    // closed unmerged, or its pass died before opening one. Ancestry says
    // nothing here — a closed PR's commits are never in the base — so the
    // test is "pushed": every commit is on the remote branch or in the base.
    // A live claim holds it (a session may have adopted it); every unknown
    // reading holds it.
    if (isIssueBranch(w.branch)) {
        if (w.liveClaim !== false)
            return {
                action: "keep",
                reason:
                    w.liveClaim === true
                        ? "issue claimed (in-progress)"
                        : "its issue's claim could not be read",
            };
        if (w.unpushed === null)
            return {
                action: "keep",
                reason: "its unpushed commits could not be counted",
            };
        if (w.unpushed > 0)
            return {
                action: "keep",
                reason: `${w.unpushed} commit(s) exist only on this disk`,
            };
        if (w.closedPr)
            return {
                action: "remove",
                reason: "PR closed unmerged, every commit pushed",
            };
        if (w.idleMinutes === undefined || w.idleMinutes === null)
            return {
                action: "keep",
                reason: "its last change could not be read",
            };
        if (w.idleMinutes < ORPHAN_IDLE_MINUTES)
            return {
                action: "keep",
                reason: `no PR, changed ${(w.idleMinutes / 60).toFixed(1)}h ago (< ${ORPHAN_IDLE_MINUTES / 60}h)`,
            };
        return {
            action: "remove",
            reason: `no PR, no claim, idle ${(w.idleMinutes / 60).toFixed(1)}h, every commit pushed`,
        };
    }

    if (w.unmerged > 0) {
        return {
            action: "keep",
            reason: `${w.unmerged} commit(s) not in ${ORIGIN_BASE}`,
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

/** A `gh` list read, or `null` when it failed — never an empty set, which
 *  would read "no PR" and push a worktree towards removal. */
function ghList<T>(args: string[], primary: string): T[] | null {
    const raw = spawnSync("gh", args, {
        encoding: "utf8",
        cwd: primary,
        env: NET_ENV,
    });
    if (raw.status !== 0) return null;
    try {
        return JSON.parse(raw.stdout) as T[];
    } catch {
        return null;
    }
}

/** What one `wt:gc` run decided and did, worktree by worktree. */
export interface GcRow {
    path: string;
    branch: string | null;
    verdict: Verdict;
    /** Set when the run removed (or tried to remove) it. */
    removed?: boolean;
}

/**
 * Classify every worktree of `primary` and, with `apply`, remove the
 * removable ones. `issuesOnly` limits it to `feat|fix/issue-N` worktrees —
 * the scheduled sweep (issue #6083), which must never reach a `wt:docs`
 * worktree, `housekeeping`'s throwaway one or a job worktree. Returns null
 * when a fact every verdict depends on (the PR lists, the claims) could not
 * be read: nothing is classified, nothing removed.
 */
export function worktreeGc(
    primary: string,
    opts: { apply: boolean; issuesOnly: boolean; now?: number }
): GcRow[] | null {
    const now = opts.now ?? Date.now();
    git(["fetch", "origin", BASE_BRANCH, "-q"], primary);
    const entries = parseWorktreeList(
        git(["worktree", "list", "--porcelain"], primary)
    )
        .filter((w) => resolve(w.path) !== resolve(primary))
        .filter((w) => !opts.issuesOnly || isIssueBranch(w.branch));

    // One list call per PR state, not one per branch: the head-branch names
    // of the newest N PRs, which is the right end of the list for this
    // question. `closed` includes merged ones; `state` tells them apart.
    const prs = (state: "open" | "merged" | "closed", limit: number) =>
        ghList<{ headRefName: string; state: string }>(
            [
                "pr",
                "list",
                "--state",
                state,
                "--limit",
                String(limit),
                "--json",
                "headRefName,state",
            ],
            primary
        );
    const open = prs("open", 300);
    const merged = prs("merged", 300);
    const closed = prs("closed", 500);
    // `pr-open` stands beside the claim while a PR waits in the queue.
    const claimed = (label: string) =>
        ghList<{ number: number }>(
            [
                "issue",
                "list",
                "--state",
                "open",
                "--label",
                label,
                "--limit",
                "300",
                "--json",
                "number",
            ],
            primary
        );
    const inProgress = claimed(CLAIM_LABEL);
    const prOpen = claimed(PR_OPEN_LABEL);
    if (
        open === null ||
        merged === null ||
        closed === null ||
        inProgress === null ||
        prOpen === null
    )
        return null;
    const openHeads = new Set(open.map((p) => p.headRefName));
    const mergedHeads = new Set(merged.map((p) => p.headRefName));
    const closedHeads = new Set(
        closed.filter((p) => p.state === "CLOSED").map((p) => p.headRefName)
    );
    const claims = new Set([...inProgress, ...prOpen].map((i) => i.number));
    const runner: ShRunner = (cmd, args) => {
        const r = spawnSync(cmd, args, {
            encoding: "utf8",
            cwd: primary,
            env: NET_ENV,
        });
        if (r.status !== 0)
            throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
        return r.stdout;
    };

    const rows: GcRow[] = [];
    for (const e of entries) {
        const issue = e.branch === null ? null : issueOfBranch(e.branch);
        // Read before `git status`, which may refresh the index it dates.
        const idleMinutes =
            issue === null ? null : worktreeQuietMinutes(issue, now, runner);
        // A `git status` that FAILED (a lock, a corrupt index) is dirty:
        // `git()` reads a failure as "", which would be a clean tree.
        const status = spawnSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
            cwd: e.path,
            env: NET_ENV,
        });
        const dirty = status.status !== 0 || status.stdout.trim() !== "";
        const unmergedOut = git(
            ["rev-list", "--count", `${ORIGIN_BASE}..HEAD`],
            e.path
        );
        const facts: WorktreeFacts = {
            ...e,
            dirty,
            unmerged: Number(unmergedOut || "0"),
            inUse: defaultCwdProbe(e.path),
            openPr: e.branch !== null && openHeads.has(e.branch),
            mergedPr: e.branch !== null && mergedHeads.has(e.branch),
            closedPr: e.branch !== null && closedHeads.has(e.branch),
            unpushed:
                e.branch === null
                    ? null
                    : unpushedOnWorktree(e.branch, ORIGIN_BASE, runner),
            liveClaim: issue === null ? undefined : claims.has(issue),
            idleMinutes,
        };
        rows.push({ path: e.path, branch: e.branch, verdict: classify(facts) });
    }
    if (!opts.apply) return rows;
    for (const row of rows) {
        if (row.verdict.action !== "remove") continue;
        row.removed =
            spawnSync("git", ["worktree", "remove", row.path], {
                stdio: "inherit",
                cwd: primary,
                env: NET_ENV,
            }).status === 0;
    }
    return rows;
}

/** One log line per worktree: what was decided, and why. */
export function gcLine(row: GcRow, parent: string): string {
    const mark =
        row.removed === true
            ? "removed"
            : row.removed === false
              ? "FAILED to remove"
              : row.verdict.action === "remove"
                ? "×"
                : "·";
    return `  ${mark} ${row.path.replace(parent + "/", "")}  [${row.branch ?? "detached"}]  ${row.verdict.reason}`;
}

if (import.meta.main) {
    const apply = process.argv.includes("--yes");
    const cwd = process.cwd();
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    const primary = common.startsWith("/") ? dirname(resolve(common)) : cwd;
    const rows = worktreeGc(primary, {
        apply,
        issuesOnly: process.argv.includes("--issues-only"),
    });
    if (rows === null) {
        console.error(
            "wt:gc: could not read the PR lists or the claims — nothing classified, nothing removed"
        );
        process.exit(1);
    }
    for (const row of rows) console.log(gcLine(row, dirname(primary)));
    const removable = rows.filter((r) => r.verdict.action === "remove");
    console.log(`\n${rows.length} worktree(s), ${removable.length} finished.`);
    if (removable.length > 0 && !apply)
        console.log("Nothing removed — re-run with --yes to remove them.");
    if (removable.some((r) => r.removed === false)) process.exit(1);
}
