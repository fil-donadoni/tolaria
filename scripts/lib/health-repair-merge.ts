/**
 * Did a base push merge a declared repair of the standing RED (issue #6553)?
 *
 * `health-early` asks it on every push: a repair's tip must not wait behind
 * the run of a superseded tip (which can only report the same RED), and its
 * merge must fire the full health gate at once, since the hosted early run
 * never writes a GREEN and nothing else would clear the RED before the cron.
 * A repair is declared by `health:fix repair-issue` (the pivot's repair
 * issues); the PR that closes one of them is the repair.
 */
import { spawnSync } from "node:child_process";
import { pivotRepairIssues } from "./health-pivot";
import { originRepo } from "./health-verdict-store";

/** True when a PR merged by the push closes one of the declared repair
 *  issues. Pure. */
export function mergesDeclaredRepair(
    repairIssues: readonly number[],
    closedByMerged: readonly number[]
): boolean {
    if (repairIssues.length === 0) return false;
    const declared = new Set(repairIssues);
    return closedByMerged.some((n) => declared.has(n));
}

/** The issue numbers the PRs merged by `sha` close, via `gh`'s token. */
export function issuesClosedBy(
    root: string,
    sha: string,
    run: (args: string[]) => string = ghOut
): number[] {
    const repo = originRepo(root);
    const prs = run([
        "api",
        `repos/${repo}/commits/${sha}/pulls`,
        "--jq",
        ".[].number",
    ])
        .split("\n")
        .filter(Boolean);
    return prs.flatMap((pr) =>
        run([
            "pr",
            "view",
            pr,
            "--repo",
            repo,
            "--json",
            "closingIssuesReferences",
            "--jq",
            ".closingIssuesReferences[].number",
        ])
            .split("\n")
            .filter(Boolean)
            .map(Number)
    );
}

function ghOut(args: string[]): string {
    const r = spawnSync("gh", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`gh ${args[0]} failed`);
    return r.stdout;
}

/** Total: any unreadable fact answers false — the ordinary serial batching
 *  then applies, which is only slower, never wrong. */
export function pushMergesDeclaredRepair(
    root: string,
    sha: string,
    run?: (args: string[]) => string
): boolean {
    try {
        const repairs = pivotRepairIssues(root);
        if (repairs.length === 0) return false;
        return mergesDeclaredRepair(repairs, issuesClosedBy(root, sha, run));
    } catch {
        return false;
    }
}
