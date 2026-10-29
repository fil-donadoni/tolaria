#!/usr/bin/env bun
/**
 * `bun run claims:sweep-closed` — release the claim labels left on CLOSED
 * issues (issue #5572).
 *
 * A claim is released by the path that ends it: the land-runner at merge,
 * `housekeeping` for the merged PRs it walks, the abort's `gh issue edit`.
 * An issue closed any other way — by hand, as a duplicate, or by a runner
 * still holding code from before the release removed `pr-open` (it never
 * reloads its own code) — kept `in-progress` / `pr-open` for good. This sweep
 * releases every one of them (`releaseEditArgs`: both labels and the
 * assignee), whatever closed it.
 *
 * Idempotent: a second run finds nothing. The list and the edit are two
 * calls: an issue reopened and re-claimed between them loses its label until
 * its next claim — a window of seconds, accepted. `housekeeping` runs it every run,
 * as a fresh process, so it always applies the CURRENT release. Flags:
 * `--dry-run` (list, touch nothing). Exit 0 when every owed release
 * succeeded (or nothing was owed), 1 when a read or an edit failed.
 */
import {
    CLAIM_LABEL,
    PR_OPEN_LABEL,
    closedClaimsToRelease,
    closedWithLabelArgs,
    releaseEditArgs,
    type ClosedIssueLabels,
} from "./lib/claim-labels";
import { gh } from "./lib/gh";

const LIST_LIMIT = 500;

function main(): number {
    const dryRun = process.argv.includes("--dry-run");
    const closed: ClosedIssueLabels[] = [];
    try {
        for (const label of [CLAIM_LABEL, PR_OPEN_LABEL]) {
            const page = JSON.parse(
                gh(closedWithLabelArgs(label, LIST_LIMIT))
            ) as ClosedIssueLabels[];
            // A full page may have left older ones out: the next run,
            // finding these released, reaches them.
            if (page.length >= LIST_LIMIT)
                console.error(
                    `claims:sweep-closed: ${LIST_LIMIT} closed issues still wear ${label} — more may remain for the next run`
                );
            closed.push(...page);
        }
    } catch (err) {
        console.error(
            `claims:sweep-closed: could not list closed issues (${(err as Error).message.split("\n")[0]})`
        );
        return 1;
    }
    const owed = closedClaimsToRelease(closed);
    if (owed.length === 0) {
        console.log("claims:sweep-closed: no closed issue holds a claim");
        return 0;
    }
    let failed = 0;
    for (const issue of owed) {
        if (dryRun) {
            console.log(`claims:sweep-closed: would release issue #${issue}`);
            continue;
        }
        try {
            gh(releaseEditArgs(issue));
            console.log(`claims:sweep-closed: released issue #${issue}`);
        } catch (err) {
            failed++;
            console.error(
                `claims:sweep-closed: issue #${issue} failed (${(err as Error).message.split("\n")[0]})`
            );
        }
    }
    return failed === 0 ? 0 : 1;
}

process.exit(main());
