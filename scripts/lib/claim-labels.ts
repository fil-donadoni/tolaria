/**
 * The issue labels a claim wears, and the `gh` edits that move them — one
 * place, so every release path removes the same set (issue #5562).
 *
 * - `in-progress` — `queue:claim` adds it; it IS the claim for every reader
 *   (`queue:plan`, orphan detection, `afk-dispatch`).
 * - `pr-open` — `land:ready` adds it BESIDE `in-progress` when the PR is
 *   handed to the land-runner: the board's view of the journal's `pr-open`
 *   row. Never instead of `in-progress`, which would hand the issue back to
 *   `queue:plan` as unclaimed.
 *
 * No imports: `telemetry-serve`, `housekeeping` and `lib/claim-verdict` read it
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

/** One CLOSED issue as `gh issue list --json number,labels` returns it. */
export interface ClosedIssueLabels {
    number: number;
    labels: { name: string }[];
}

/** The `gh` read listing CLOSED issues still wearing `label` (issue #5572). */
export function closedWithLabelArgs(label: string, limit = 500): string[] {
    return [
        "issue",
        "list",
        "--state",
        "closed",
        "--label",
        label,
        "--limit",
        String(limit),
        "--json",
        "number,labels",
    ];
}

/** Issue #5572 — the closed issues whose claim was never released: any that
 *  still wear `in-progress` or `pr-open`, once each, ascending. A closed
 *  issue is no claim whatever path closed it (a merge whose runner held
 *  pre-#5562 code, a close by hand, a duplicate), so the release is owed
 *  unconditionally. */
export function closedClaimsToRelease(
    closed: readonly ClosedIssueLabels[]
): number[] {
    const owed = new Set<number>();
    for (const issue of closed) {
        if (
            issue.labels.some(
                (l) => l.name === CLAIM_LABEL || l.name === PR_OPEN_LABEL
            )
        )
            owed.add(issue.number);
    }
    return [...owed].sort((a, b) => a - b);
}
