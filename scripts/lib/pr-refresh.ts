/**
 * The decisions of `scripts/pr-refresh.ts` (issue #5638): which queued PRs a
 * push to the base obliges a refresh of, and what the owner reads when one
 * cannot be refreshed. Pure — the git and `gh` I/O is the script's.
 */
import { FAILED_LABEL, READY_LABEL, MANUAL_LABEL } from "./land-labels";

/** One PR as `gh pr list --label ready-to-land --json …` reads it. */
export interface RefreshPr {
    number: number;
    headRefName: string;
    headRefOid: string;
    /** GitHub's lazily computed verdict; `UNKNOWN` until it has looked. */
    mergeable: string;
    /** A fork's branch never reaches an owner's machine. */
    isCrossRepository: boolean;
    labels: readonly string[];
    files: readonly string[];
}

export type RefreshReason = "conflicting" | "base-touched";

export interface RefreshCandidate {
    pr: RefreshPr;
    reason: RefreshReason;
    /** The base's files this PR also changes (empty for a bare `conflicting`). */
    overlap: string[];
}

/**
 * The PRs to refresh: `ready-to-land`, not `land-failed`, from this
 * repository, and either GitHub reports `CONFLICTING` (it does not run our
 * merge drivers, so a generated artifact conflicts there however resolvable)
 * or the push to the base touched a file the PR changes. `baseTouched` is
 * `null` when the push's range is unknown (a first push): only the
 * conflicting ones then qualify. A PR without `merge:manual` is the Mergify queue's:
 * its draft already tests it on the moved base, and a push to it dequeues it,
 * so only `CONFLICTING` — a rebase only our merge drivers can do — takes it
 * (issue #5983).
 */
export function selectRefreshCandidates(
    prs: readonly RefreshPr[],
    baseTouched: ReadonlySet<string> | null
): RefreshCandidate[] {
    const out: RefreshCandidate[] = [];
    for (const pr of prs) {
        if (pr.isCrossRepository) continue;
        if (!pr.labels.includes(READY_LABEL)) continue;
        if (pr.labels.includes(FAILED_LABEL)) continue;
        const overlap = baseTouched
            ? pr.files.filter((f) => baseTouched.has(f))
            : [];
        if (pr.mergeable === "CONFLICTING") {
            out.push({ pr, reason: "conflicting", overlap });
        } else if (overlap.length > 0 && pr.labels.includes(MANUAL_LABEL)) {
            out.push({ pr, reason: "base-touched", overlap });
        }
    }
    return out.sort((a, b) => a.pr.number - b.pr.number);
}

/** What `git rebase` itself prints on stdout before `rebaseStep()`'s own diff. */
const GIT_NOISE =
    /^(Auto-merging |CONFLICT |Rebasing |Successfully |Applying |Recorded |Resolved |Falling back |error: |hint: |warning: |Could not |Merge conflict |Patch failed|From |To |\s)/;

/**
 * The conflicting paths `rebaseStep()` printed before it aborted: `git rebase`'s
 * own chatter (`Auto-merging …`, `CONFLICT …`) then one path per line from its
 * `diff --name-only --diff-filter=U`. Empty = the rebase failed for a reason
 * that is no conflict (a failed fetch): the PR is left queued, never labelled.
 */
export function parseConflictPaths(stdout: string): string[] {
    return [
        ...new Set(
            stdout.split("\n").filter((l) => l !== "" && !GIT_NOISE.test(l))
        ),
    ];
}

/** The comment on a PR labelled `land-failed` for a conflict outside generated files. */
export function conflictComment(input: {
    paths: readonly string[];
    base: string;
    repairable: boolean;
}): string {
    return [
        `**pr-refresh: rebase onto \`${input.base}\` conflicts** — labelled \`${FAILED_LABEL}\`.`,
        "",
        "Conflicting paths (not generated artefacts, so no merge driver resolves them):",
        "",
        ...input.paths.map((p) => `- \`${p}\``),
        "",
        input.repairable
            ? "`queue:plan` hands this PR to the next pass as a repair pick (`/next-ticket <issue> --resume`); after the fix, `bun run land:ready <PR#>` re-queues it."
            : "This branch names no issue, so no pass is handed it: a human repairs it; after the fix, `bun run land:ready <PR#>` re-queues it.",
    ].join("\n");
}
