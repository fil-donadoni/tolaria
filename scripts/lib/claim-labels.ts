/**
 * The issue labels a claim wears, and the `gh` edits that move them — one
 * place, so every release path removes the same set (issue #5562).
 *
 * - `in-progress` — `queue:claim` adds it; it IS the claim for every reader
 *   (`queue:plan`, orphan detection, `loop-drain.sh`).
 * - `pr-open` — `land:ready` adds it BESIDE `in-progress` when the PR is
 *   handed to the land-runner: the board's view of the journal's `pr-open`
 *   row. Never instead of `in-progress`, which would hand the issue back to
 *   `queue:plan` as unclaimed.
 *
 * No imports: `telemetry-serve`, `housekeeping` and `loop-doctor` read it
 * without dragging the planner in.
 */

export const CLAIM_LABEL = "in-progress";
export const PR_OPEN_LABEL = "pr-open";

/** The `gh` edit that undoes `queue:claim`'s — label(s), assignee, never one
 *  half. Removing `pr-open` from an issue that lacks it is a no-op for `gh`. */
export function releaseEditArgs(issue: number): string[] {
    return [
        "issue",
        "edit",
        String(issue),
        "--remove-label",
        CLAIM_LABEL,
        "--remove-label",
        PR_OPEN_LABEL,
        "--remove-assignee",
        "@me",
    ];
}

/** The `gh` edit `land:ready` makes on the PR's issue. */
export function prOpenEditArgs(issue: number): string[] {
    return ["issue", "edit", String(issue), "--add-label", PR_OPEN_LABEL];
}
