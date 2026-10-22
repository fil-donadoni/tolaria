/**
 * Stale land tooling (issue #6341).
 *
 * `land:ready` is the code at the PR's own worktree checkout. When the base
 * moves the land tooling after a session branched, that session's hand-off
 * runs the OLD script against the OLD guard set: it labels the PR
 * `ready-to-land`, the queue's lane (current base tooling) then reds it, and
 * the sticky dequeue reason bounces a bare re-run (PR #6337: the pre-ADR 0157
 * `land:ready` restored no derived state). The pre-queue check cannot see
 * this — it is the stale script judging itself.
 *
 * The predicate is pure: the paths the base changed since the merge-base in,
 * the ones that are tooling out.
 */

const TOOLING: readonly RegExp[] = [
    /^scripts\/(?!__tests__\/).+\.ts$/,
    /^package\.json$/,
    /^\.claude\/hooks\//,
    /^tolaria\.config\.json$/,
];

/** The changed paths that are land tooling (a test file is not). */
export function staleToolingPaths(changedOnBase: readonly string[]): string[] {
    return changedOnBase.filter((p) => TOOLING.some((re) => re.test(p)));
}

/** The refusal line for `land:ready`, or null when its tooling is current. */
export function staleToolingRefusal(
    changedOnBase: readonly string[],
    base: string
): string | null {
    const stale = staleToolingPaths(changedOnBase);
    if (stale.length === 0) return null;
    const shown = stale.slice(0, 5).join(", ");
    const more = stale.length > 5 ? ` (+${stale.length - 5} more)` : "";
    return `this worktree's land tooling is older than ${base}: ${shown}${more} changed on the base since the branch forked, so this land:ready would run without them — \`git fetch origin && git rebase ${base}\`, push, re-run`;
}
