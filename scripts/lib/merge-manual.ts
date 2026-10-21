/**
 * The decision behind `bun run merge:manual <PR#>` (issue #6238): may a PR the
 * Mergify queue refuses be merged by hand NOW?
 *
 * Such a PR (one touching `.github/` or `.mergify.yml`) has no queue draft and
 * no `queue-lane`: its own `check:lane (advisory)` run is the only lane its
 * tree ever gets. A hand merge that does not wait for that run, or that
 * merges a head the base has since moved past, lands a tree no lane has seen
 * — and the next batch health goes RED on the base tip. So the merge is
 * admitted only when the latest advisory-lane run on the PR's CURRENT head
 * concluded `success` and that head already contains the base tip (then the
 * run's tree is the tree that lands).
 *
 * Pure; `scripts/merge-manual.ts` reads GitHub and merges through
 * `scripts/pr-merge.ts`.
 */
import { ADVISORY_LANE_CHECK } from "../ci/workflow-structure";
import { MANUAL_LABEL } from "./land-labels";

/** The fields of one check run (`commits/{sha}/check-runs`) this reads. */
export interface CheckRunView {
    id: number;
    name: string;
    headSha: string;
    status: string;
    conclusion: string | null;
}

export interface ManualMergeInput {
    state: string;
    labels: readonly string[];
    headSha: string;
    /** Commits the base has that the head lacks (`compare/{base}...{head}`). */
    behindBy: number;
    checkRuns: readonly CheckRunView[];
}

export type ManualMergeVerdict =
    | { kind: "merge" }
    | { kind: "refuse"; reason: string };

/** The latest advisory-lane run on `headSha` — a re-run supersedes. */
export function latestAdvisoryLane(
    runs: readonly CheckRunView[],
    headSha: string
): CheckRunView | undefined {
    return runs
        .filter((r) => r.name === ADVISORY_LANE_CHECK && r.headSha === headSha)
        .sort((a, b) => b.id - a.id)[0];
}

export function manualMergeVerdict(
    input: ManualMergeInput
): ManualMergeVerdict {
    const refuse = (reason: string): ManualMergeVerdict => ({
        kind: "refuse",
        reason,
    });
    if (input.state !== "OPEN") return refuse(`PR is ${input.state}`);
    if (!input.labels.includes(MANUAL_LABEL))
        return refuse(
            `not labelled \`${MANUAL_LABEL}\` — the Mergify queue lands it`
        );
    if (input.behindBy > 0)
        return refuse(
            `head is ${input.behindBy} commit(s) behind the base: rebase it, then wait for \`${ADVISORY_LANE_CHECK}\` on the new head`
        );
    const lane = latestAdvisoryLane(input.checkRuns, input.headSha);
    if (!lane)
        return refuse(
            `no \`${ADVISORY_LANE_CHECK}\` run on head ${input.headSha.slice(0, 12)}`
        );
    if (lane.status !== "completed")
        return refuse(
            `\`${ADVISORY_LANE_CHECK}\` is still ${lane.status} on head ${input.headSha.slice(0, 12)} — wait for it`
        );
    if (lane.conclusion !== "success")
        return refuse(
            `\`${ADVISORY_LANE_CHECK}\` concluded ${lane.conclusion ?? "nothing"} on head ${input.headSha.slice(0, 12)}`
        );
    return { kind: "merge" };
}
