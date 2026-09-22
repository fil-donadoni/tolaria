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
