// The robustness-baseline owner gate (issue #4980).
//
// WHY THIS EXISTS. `ROBUSTNESS_BASELINE` (`convex/gre/ai/blade/
// robustnessBaseline.ts`, issue #4875) is shrink-only: the audit reds on a
// listed entry that has become robust. The audit itself is health-only — ~15
// min of search, far over the lane budget (issue #4963) — so nothing at `land`
// ever asked the one question a PR can answer for free: does it close the
// issue that OWNS a row? PR #4933 closed issue #4917, the owner of the
// "Discard sorcery with a sacrifice cost" row, fixed the search defect that
// pinned the entry, and left the row; the next health run went RED on
// "is robust now — delete its baseline row" (issue #4980).
//
// A row's owner closing is the event that should move the row, and it is
// visible in the PR body. So: a PR that closes a row's owner while the row is
// still in the tree it lands is refused, and told the two exits — delete the
// row (the entry is robust now), or re-point it to the issue that owns it next.
//
// What this does NOT catch, by design: a pin created or cleared by a weight or
// search change whose PR closes no owner. That is the audit's accepted
// health-only blind spot (`healthGates` in `health-step.ts`). Nor an owner
// closed outside the PR body (a sidebar link, a commit message): the body's
// closing keywords are the same reading the RED gate makes (`closingIssueRefs`).
//
// The baseline read is the PR's tree BEFORE `land` rebases: a row the base
// already deleted or re-pointed still refuses a stale branch — rebase it first.

/** The row shape this gate needs — a structural subset of
 *  `RobustnessBaselineRow`, so `scripts/` does not type-depend on the blade. */
export interface BaselineOwnerRow {
    readonly label: string;
    readonly issue: number;
}

/** Refusal string when `closing` names the owner of a row still in
 *  `baseline`, else null. */
export function robustnessBaselineRefusal(
    baseline: readonly BaselineOwnerRow[],
    closing: readonly number[]
): string | null {
    const stale = baseline.filter((row) => closing.includes(row.issue));
    if (stale.length === 0) return null;
    const rows = stale
        .map((row) => `"${row.label}" (owned by issue #${row.issue})`)
        .join(", ");
    return `this PR closes the owner of a blade robustness baseline row still in the tree — ${rows}. Delete the row in convex/gre/ai/blade/robustnessBaseline.ts if the entry is robust now (BLADE_ROBUSTNESS=1 bunx vitest run --config vitest.blade.config.ts robustness.shard -t "<label>"), or re-point it to the issue that owns it next`;
}
