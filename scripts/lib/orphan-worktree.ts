// Orphaned issue worktrees (issue #5531): an open issue whose `in-progress`
// claim is gone but whose local `feat|fix/issue-N` worktree still holds
// commits that exist nowhere else.
//
// The loop resumes a dead pass's work only through its CLAIM (the claim verdict's
// `recoverable` / `stranded`). Once the label is dropped, the worktree and its
// commits are invisible to that path: the issue is `ready-for-agent`, the
// planner offers it as a fresh pick, and the committed work is either
// collided with or silently ignored. This module is the census beside the
// claim classifier, with the SAME tri-state discipline as
// `ClaimFacts.ownerAlive`: only a POSITIVE reading moves a verdict, and an
// unknown one holds the worktree (neither adopted nor picked fresh) instead of
// authorising anything.

import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import {
    DEAD_OWNER_QUIET_MINUTES,
    isOwnerAlive,
    shChecked,
    worktreeQuietMinutes,
    type ClaimOwner,
    type ProcessProbe,
    type ShRunner,
} from "./claim-verdict";
import { parseWorktreeList } from "../worktree-gc";
import { issueOfBranch } from "./issue-worktree";

export type OrphanWorktreeFacts = {
    issue: number;
    path: string;
    /**
     * Commits on the worktree's branch absent from origin AND from base.
     * `0` = nothing to lose (a fresh pick may reuse the worktree), `null` =
     * unreadable — held, never adopted and never picked fresh over.
     */
    unpushedCommits: number | null;
    /** The claim journal has a recorded owner for this issue. */
    ownerRecorded: boolean;
    /** `ClaimFacts.ownerAlive`: `null` = no owner recorded, or probe unavailable. */
    ownerAlive: boolean | null;
    /** A live process has its cwd inside the worktree; `null` = unreadable. */
    processInside: boolean | null;
    /** Minutes since the worktree last changed; `null` = unreadable. */
    quietMinutes: number | null;
};

/**
 *   - `none`  — no unpushed commit: no work to lose, not an orphan.
 *   - `adopt` — proven ownerless: the next pass resumes it as `recoverable`.
 *   - `held`  — somebody may be at work, or a reading is unknown: neither
 *               adopted nor picked fresh, reported by name.
 */
export type OrphanVerdict = {
    state: "none" | "adopt" | "held";
    reason: string;
};

/** Pure: facts → verdict. Every condition for `adopt` is a positive reading. */
export function classifyOrphanWorktree(f: OrphanWorktreeFacts): OrphanVerdict {
    if (f.unpushedCommits === 0)
        return {
            state: "none",
            reason: "no unpushed commit — nothing to lose",
        };
    if (f.unpushedCommits === null)
        return held(f, "its unpushed commits could not be counted");
    if (f.ownerAlive === true)
        return held(f, "the process that last claimed it is still running");
    // A recorded owner whose liveness could not be read is NOT "never recorded".
    if (f.ownerRecorded && f.ownerAlive === null)
        return held(f, "its last owner's liveness could not be read");
    if (f.processInside === null)
        return held(f, "the processes inside it could not be listed");
    if (f.processInside) return held(f, "a live process has its cwd inside it");
    if (f.quietMinutes === null)
        return held(f, "its last change could not be read");
    if (f.quietMinutes < DEAD_OWNER_QUIET_MINUTES)
        return held(
            f,
            `it changed ${f.quietMinutes.toFixed(0)}m ago — a session may be at work`
        );
    return {
        state: "adopt",
        reason: `no claim, owner ${f.ownerRecorded ? "provably dead" : "never recorded"}, nothing inside it, quiet ${f.quietMinutes.toFixed(0)}m, ${f.unpushedCommits} unpushed commit${f.unpushedCommits === 1 ? "" : "s"} — the next pass resumes it`,
    };
}

function held(f: OrphanWorktreeFacts, why: string): OrphanVerdict {
    return {
        state: "held",
        reason: `worktree ${f.path} holds ${f.unpushedCommits ?? "?"} unpushed commit(s) but ${why} — not adopted, not picked fresh`,
    };
}

export type OrphanWorktree = {
    issue: number;
    path: string;
    branch: string;
    verdict: OrphanVerdict;
};

/** Does any live process (other than this one) have its cwd inside `dir`?
 *  `null` = could not tell. `lsof` first, `/proc` where there is no `lsof`. */
export type CwdProbe = (dir: string) => boolean | null;

export function parseLsofCwds(out: string): { pid: number; cwd: string }[] {
    const rows: { pid: number; cwd: string }[] = [];
    let pid = 0;
    for (const line of out.split("\n")) {
        if (line.startsWith("p")) pid = Number(line.slice(1));
        else if (line.startsWith("n") && pid > 0)
            rows.push({ pid, cwd: line.slice(1) });
    }
    return rows;
}

export function cwdInside(cwd: string, dir: string): boolean {
    return cwd === dir || cwd.startsWith(`${dir}/`);
}

export const defaultCwdProbe: CwdProbe = (dir) => {
    let real: string;
    try {
        real = realpathSync(dir);
    } catch {
        return null;
    }
    const r = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpn"], {
        encoding: "utf8",
        timeout: 10_000,
    });
    if (!r.error && (r.stdout ?? "").startsWith("p")) {
        return parseLsofCwds(r.stdout).some(
            (p) => p.pid !== process.pid && cwdInside(p.cwd, real)
        );
    }
    try {
        let unreadable = 0;
        let inside = false;
        for (const name of readdirSync("/proc")) {
            if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
            try {
                if (cwdInside(readlinkSync(`/proc/${name}/cwd`), real))
                    inside = true;
            } catch {
                unreadable++;
            }
        }
        // Another user's processes are unreadable: only a positive match or a
        // clean sweep is a reading.
        return inside ? true : unreadable === 0 ? false : null;
    } catch {
        return null;
    }
};

/**
 * Commits on `branch` absent from `baseRef` and from `origin/<branch>` (when
 * the remote has it). `null` = unreadable.
 */
export function unpushedOnWorktree(
    branch: string,
    baseRef: string,
    runner: ShRunner = shChecked
): number | null {
    try {
        const args = ["rev-list", "--count", branch, "--not", baseRef];
        const pushed = runner("git", [
            "for-each-ref",
            "--format=%(refname)",
            `refs/remotes/origin/${branch}`,
        ]).trim();
        if (pushed) args.push(`origin/${branch}`);
        const n = Number(runner("git", args).trim());
        return Number.isInteger(n) && n >= 0 ? n : null;
    } catch {
        return null;
    }
}

/**
 * The census: every local `feat|fix/issue-N` worktree whose issue is in
 * `unclaimed` (open, no `in-progress` claim), with its verdict. Worktrees at
 * zero unpushed commits are left out (`none`). Total: an unreadable worktree
 * list is `[]` — the pre-#5531 behaviour, never an adoption.
 */
export function orphanWorktrees(
    unclaimed: ReadonlySet<number>,
    deps: {
        baseRef: string;
        owners: Map<number, ClaimOwner>;
        now?: number;
        probe?: ProcessProbe;
        runner?: ShRunner;
        cwdProbe?: CwdProbe;
        /** `worktreeQuietMinutes` — the tests' seam. */
        quiet?: (issue: number, now: number) => number | null;
    }
): OrphanWorktree[] {
    const runner = deps.runner ?? shChecked;
    const now = deps.now ?? Date.now();
    let entries: ReturnType<typeof parseWorktreeList>;
    try {
        entries = parseWorktreeList(
            runner("git", ["worktree", "list", "--porcelain"])
        );
    } catch {
        return [];
    }
    const out: OrphanWorktree[] = [];
    for (const e of entries) {
        if (e.branch === null) continue;
        const issue = issueOfBranch(e.branch);
        if (issue === null || !/^(feat|fix)\//.test(e.branch)) continue;
        if (!unclaimed.has(issue)) continue;
        const unpushedCommits = unpushedOnWorktree(
            e.branch,
            deps.baseRef,
            runner
        );
        if (unpushedCommits === 0) continue;
        const owner = deps.owners.get(issue);
        const verdict = classifyOrphanWorktree({
            issue,
            path: e.path,
            unpushedCommits,
            ownerRecorded: owner !== undefined,
            ownerAlive: isOwnerAlive(owner, deps.probe),
            processInside: (deps.cwdProbe ?? defaultCwdProbe)(e.path),
            quietMinutes: (
                deps.quiet ?? ((n, t) => worktreeQuietMinutes(n, t, runner))
            )(issue, now),
        });
        out.push({ issue, path: e.path, branch: e.branch, verdict });
    }
    return out.sort((a, b) => a.issue - b.issue);
}

/** Report lines for the held ones — empty when none. */
export function renderHeldOrphanLines(found: OrphanWorktree[]): string[] {
    const heldRows = found.filter((o) => o.verdict.state === "held");
    if (heldRows.length === 0) return [];
    return [
        `Held orphan worktrees (${heldRows.length}) — unclaimed issue, unpushed commits, owner not proven gone`,
        ...heldRows.map((o) => `  ? #${o.issue}  ${o.verdict.reason}`),
    ];
}
