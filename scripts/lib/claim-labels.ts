/**
 * The issue labels a claim wears, and the `gh` edits that move them — one
 * place, so every release path removes the same set (issue #5562).
 *
 * - `in-progress` — `afk-dispatch`, or an attended `/next-ticket` session
 *   with `gh issue edit`, adds it; it IS the claim for every reader
 *   (`queue:plan`, orphan detection, `afk-dispatch`, ADR 0156).
 * - `pr-open` — `land:ready` adds it BESIDE `in-progress` when the PR is
 *   handed to the queue. Never instead of `in-progress`, which would hand
 *   the issue back to `queue:plan` as unclaimed.
 *
 * No imports: `telemetry-serve`, `housekeeping` and `lib/claim-verdict` read it
 * without dragging the planner in.
 */

export const CLAIM_LABEL = "in-progress";
export const PR_OPEN_LABEL = "pr-open";

/** The `gh` edit that undoes a claim — label(s), assignee, never one
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

/** The announced escape from `claimRefusal` (issue #5996). */
export const UNCLAIMED_OK_ENV = "TOLARIA_UNCLAIMED_OK";

/**
 * Issue #5996: `wt:new` and `land:ready` touch no worktree and no label for
 * an issue nobody claimed. The claim is the label (ADR 0156), so the check
 * is the label: `null` = proceed, else the refusal message. Which SESSION
 * holds it is recorded nowhere — claiming before `wt:new` is what keeps two
 * sessions off one issue. `labelsOf` is the caller's `gh` read, asked only
 * when the escape is not set.
 */
export function claimRefusal(
    issue: number,
    verb: string,
    env: NodeJS.ProcessEnv,
    labelsOf: (issue: number) => readonly string[]
): string | null {
    if (env[UNCLAIMED_OK_ENV] === "1") {
        console.error(
            `${verb}: claim check OVERRIDDEN (${UNCLAIMED_OK_ENV}=1) — issue #${issue}`
        );
        return null;
    }
    if (labelsOf(issue).includes(CLAIM_LABEL)) return null;
    return (
        `${verb}: issue #${issue} is not claimed (no \`${CLAIM_LABEL}\` label) — claim it first ` +
        `(\`gh issue edit ${issue} --add-label ${CLAIM_LABEL} --add-assignee @me\`, /next-ticket § 2), ` +
        `or re-run with ${UNCLAIMED_OK_ENV}=1 to proceed deliberately`
    );
}

/** The `gh` read `claimRefusal`'s callers pass as `labelsOf`. */
export function issueLabelArgs(issue: number): string[] {
    return [
        "issue",
        "view",
        String(issue),
        "--json",
        "labels",
        "--jq",
        ".labels[].name",
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
