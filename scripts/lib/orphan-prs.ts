/**
 * The open PR of a gap issue `gaps:sync` closes (issue #6920). Closing the
 * issue releases its claim, so a PR left open has no owner: it sits
 * `land-failed` and shows up as a repair pick. A PR the merge queue holds
 * (`queued`, a queue draft, `ready-to-land`) is a human's call, so it is named
 * in the issue's closing comment instead of closed.
 */

import { type OpenPr, queueState } from "./base-drift";

/** An open PR as `gaps:sync` reads it: enough for `queueState` and the
 *  issue match (`issuesOfPr`). */
export type OrphanPrCandidate = Pick<
    OpenPr,
    "number" | "labels" | "headRefName" | "author" | "isCrossRepository"
>;

export interface OrphanPrPlan {
    /** Open and not in the queue's hands: closed with the issue. */
    readonly close: readonly number[];
    /** Queued or `ready-to-land`: left open, named in the issue's comment. */
    readonly keep: readonly number[];
}

/** Pure decision: which of an issue's open PRs close with it. */
export function planOrphanPrs(
    issue: number,
    prs: readonly OrphanPrCandidate[]
): OrphanPrPlan {
    const close: number[] = [];
    const keep: number[] = [];
    for (const pr of prs) {
        // Only a PR whose BRANCH is this issue's is closed: a closing keyword
        // in a body also matches "Closes #A, closes #B" or a negation, and
        // those PRs may be live work for another issue.
        const owned = new RegExp(`issue-${issue}$`).test(pr.headRefName);
        (owned && queueState({ ...pr, title: "", files: [] }) === null
            ? close
            : keep
        ).push(pr.number);
    }
    return { close, keep };
}

/** The comment a closed orphan PR carries. */
export function orphanPrComment(issue: number, tip: string): string {
    return `Closed by \`gaps:sync\` at ${tip}: issue #${issue} was closed because its gap is no longer computed, so this PR has no owner. Re-open it if the gap comes back.`;
}

/** The line the issue's closing comment adds for PRs left open, or `null`. */
export function keptPrsLine(keep: readonly number[]): string | null {
    return keep.length === 0
        ? null
        : `Left open (queued or \`ready-to-land\`, a human may still want it): ${keep.map((n) => `PR #${n}`).join(", ")}.`;
}
