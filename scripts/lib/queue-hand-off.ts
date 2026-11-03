/**
 * The hand-off's decisions (issue #5952, ADR 0156): who merges a PR handed
 * off as `ready-to-land` — the Mergify queue, or the owner by
 * `bun run merge:manual` — the body GitHub closes the issue from, and the
 * `gh` argv of each label move. Pure; `land-ready.ts`, `pr-refresh.ts` and
 * `lib/owner-merge.ts` are the I/O.
 *
 * Extracted from the retired land-runner's `lib/land-runner.ts` when the
 * runner was deleted (issue #5654): these three were the only decisions a
 * live path still read.
 */
import { FAILED_LABEL, MANUAL_LABEL, READY_LABEL } from "./land-labels";
import type { GateState } from "./pr-gate";

/**
 * Whether `land:ready` hands the PR to the Mergify queue (issue #5952, the
 * owner's decision of 2026-10-18), else to the owner (`merge:manual`). The
 * queue admits only a PR whose `trusted-author` status is green — `pr-gate`'s
 * own decision, read whole (`trustedAuthorStatus`): a PR it refuses carries
 * `merge:manual`, so it never sits with no merger.
 */
export function handsToQueue(input: { trustedAuthor: GateState }): boolean {
    return input.trustedAuthor === "success";
}

/**
 * The PR body with a bare `Closes #<issue>` appended when GitHub does not
 * already link the PR as closing the issue its branch names, else null. The
 * base is the default branch, so GitHub closes a linked issue at merge
 * whoever merges — and an open issue whose claim `housekeeping` releases
 * would be picked again (issue #5952). `closing` is GitHub's own
 * `closingIssuesReferences`, never a parse of the body (a negated "does not
 * close #N" still closes it).
 */
export function bodyWithClosingRef(
    body: string,
    issue: number,
    closing: readonly number[]
): string | null {
    if (closing.includes(issue)) return null;
    return `${body.replace(/\s+$/, "")}\n\nCloses #${issue}\n`;
}

/** `gh` argv for each label move — one place, so tests pin them. */
export const labelArgs = {
    /** `manual` (`!handsToQueue`): the owner merges the PR, so it carries
     *  `merge:manual`; a queue PR loses one it carried, so it never sits
     *  with no merger (issue #5952). */
    ready: (pr: number, opts: { manual: boolean }): string[] => [
        "pr",
        "edit",
        String(pr),
        "--add-label",
        READY_LABEL,
        ...(opts.manual ? ["--add-label", MANUAL_LABEL] : []),
        "--remove-label",
        FAILED_LABEL,
        ...(opts.manual ? [] : ["--remove-label", MANUAL_LABEL]),
    ],
    failed: (pr: number): string[] => [
        "pr",
        "edit",
        String(pr),
        "--remove-label",
        READY_LABEL,
        "--add-label",
        FAILED_LABEL,
    ],
};
