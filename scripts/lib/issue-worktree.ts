// The issue-worktree naming rule — ONE definition (issue #4378).
//
// `wt:new` creates the worktree; `land`'s housekeeping-recovery mode has to
// find it again from nothing but the PR's head branch, because the recovery
// is invoked from a checkout that is NOT that worktree (typically the
// primary, sitting on the base branch). Two copies of "where does the
// worktree for issue N live" is the drift that makes the teardown remove the
// wrong directory, so the rule lives here and both callers import it.

import { basename, dirname, resolve } from "node:path";

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

/**
 * Which branch a `wt:new N --resume` checks out (issue #4763) — pure, for the
 * test. A stranded claim's work is on `feat/issue-N` or `fix/issue-N`; the
 * LOCAL branch wins when both exist, because a dead pass can leave commits it
 * never pushed (observed: three, on a pushed branch). `null` = nothing to
 * resume.
 */
export function pickResumeBranch(
    issue: number,
    local: string[],
    remote: string[]
): { branch: string; from: "local" | "remote" } | null {
    const names = (["feat", "fix"] as const).map((k) => `${k}/issue-${issue}`);
    for (const branch of names)
        if (local.includes(branch)) return { branch, from: "local" };
    for (const branch of names)
        if (remote.includes(branch)) return { branch, from: "remote" };
    return null;
}
