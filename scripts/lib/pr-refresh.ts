/**
 * The decisions of `scripts/pr-refresh.ts` (issue #5638): which queued PRs a
 * push to the base obliges a refresh of, and what the owner reads when one
 * cannot be refreshed. Pure — the git and `gh` I/O is the script's.
 */
import { CHEAP_GUARDS } from "../check-lane";
import {
    FAILED_LABEL,
    HELD_LABEL,
    READY_LABEL,
    MANUAL_LABEL,
} from "./land-labels";
import { MERGIFY_QUEUED_LABEL } from "./pr-gate";

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

export type RefreshReason = "conflicting" | "base-touched" | "held";

export interface RefreshCandidate {
    pr: RefreshPr;
    reason: RefreshReason;
    /** The base's files this PR also changes (empty for a bare `conflicting`). */
    overlap: string[];
}

export interface RefreshOptions {
    /** The base lineage blocks (`lineageBlocks`: RED or second RED). */
    red: boolean;
    /**
     * PRs `git merge-tree` finds conflicting against the base tip, whatever
     * GitHub's lagging `mergeable` says (`UNKNOWN` waits for the next push).
     */
    localConflicts?: ReadonlySet<number>;
    /**
     * The base's changes since THIS PR forked (merge-base..tip), when known:
     * it replaces the push's own range, which a concurrency-dropped run no
     * longer sees whole (issue #6651).
     */
    touchedSince?: (pr: RefreshPr) => ReadonlySet<string> | null;
    /** Told about a PR a reason would have taken but a guard left alone. */
    onSkip?: (pr: RefreshPr, why: string) => void;
}

/**
 * The PRs to refresh: `ready-to-land`, not `land-failed`, from this
 * repository, and either GitHub reports `CONFLICTING` (it does not run our
 * merge drivers, so a generated artifact conflicts there however resolvable)
 * or the push to the base touched a file the PR changes. `baseTouched` is
 * `null` when the push's range is unknown (a first push): only the
 * conflicting ones then qualify. A PR without `merge:manual` is the Mergify queue's:
 * its draft already tests it on the moved base, and a push to it dequeues it,
 * so only `CONFLICTING` — a rebase only our merge drivers can do — takes it.
 * A PR Mergify holds in the queue (`queued`: its draft is running or green)
 * is taken on `CONFLICTING` only, whatever its other labels. A `queue:held`
 * PR is out of the queue, so a push costs it nothing, and while the base is
 * RED a base push that touches one of its files takes it (issue #6651): a RED reds its advisory lane, which tests the
 * PR merged with the base, and that run is pinned to the broken merge — only
 * a new push re-runs the lane on the moved base. Off RED the label is stale,
 * not a reason: rebasing every held PR on every push after a GREEN dequeued
 * green drafts and livelocked the queue (issue #6957).
 */
export function selectRefreshCandidates(
    prs: readonly RefreshPr[],
    baseTouched: ReadonlySet<string> | null,
    opts: RefreshOptions
): RefreshCandidate[] {
    const out: RefreshCandidate[] = [];
    for (const pr of prs) {
        if (pr.isCrossRepository) continue;
        if (!pr.labels.includes(READY_LABEL)) continue;
        if (pr.labels.includes(FAILED_LABEL)) continue;
        const touched = opts.touchedSince?.(pr) ?? baseTouched;
        const overlap = touched ? pr.files.filter((f) => touched.has(f)) : [];
        if (
            pr.mergeable === "CONFLICTING" ||
            opts.localConflicts?.has(pr.number)
        ) {
            out.push({ pr, reason: "conflicting", overlap });
            continue;
        }
        const reason: RefreshReason | null =
            overlap.length > 0 && pr.labels.includes(MANUAL_LABEL)
                ? "base-touched"
                : pr.labels.includes(HELD_LABEL)
                  ? "held"
                  : null;
        if (reason === null) continue;
        if (pr.labels.includes(MERGIFY_QUEUED_LABEL)) {
            opts.onSkip?.(pr, `${reason}: in the merge queue, skipped`);
        } else if (reason === "held" && !opts.red) {
            opts.onSkip?.(pr, "held label stale, skipped");
        } else if (reason === "held" && overlap.length === 0) {
            // A push to a held PR re-runs the hosted lane; the base change
            // touching none of its files cannot have moved what that lane
            // judges (issue #6651).
            opts.onSkip?.(
                pr,
                "held: the base change touches none of its files, skipped"
            );
        } else {
            out.push({ pr, reason, overlap });
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
        ...(input.paths.length > 0
            ? [
                  "Conflicting paths (not generated artefacts, so no merge driver resolves them):",
                  "",
                  ...input.paths.map((p) => `- \`${p}\``),
              ]
            : [
                  "git reported a conflict but named no path (a rename or mode conflict, or a conflict git does not list as unmerged): run `git fetch origin && git rebase " +
                      input.base +
                      "` and read what it prints.",
              ]),
        "",
        input.repairable
            ? "`queue:plan` hands this PR to the next pass as a repair pick (`/next-ticket <issue> --resume`); after the fix, `bun run land:ready <PR#>` re-queues it."
            : "This branch names no issue, so no pass is handed it: a human repairs it; after the fix, `bun run land:ready <PR#>` re-queues it.",
    ].join("\n");
}

/** A step `pr-refresh` runs on the rebased tree before it pushes. */
export interface SemanticCheck {
    id: string;
    command: string;
}

/**
 * The seconds-cost semantic checks a clean rebase owes before its push (issue
 * #6651): the census and counter invariants the lane's cheap tier runs as
 * plain scripts (`CHEAP_GUARDS`, the one authority — `pre-queue-steps.ts`
 * filters the same table), admitted by the paths the PR changes against the
 * base. Never a second list of guards.
 */
export function semanticChecks(
    changedFiles: readonly string[]
): SemanticCheck[] {
    return CHEAP_GUARDS.filter(
        (g) =>
            g.command === undefined &&
            changedFiles.some((f) => g.admits.test(f))
    ).map((g) => ({ id: g.id, command: `bun run ${g.id}` }));
}

/** The comment on a PR a clean rebase left red on a semantic check. */
export function semanticComment(input: {
    check: SemanticCheck;
    detail: string;
    base: string;
    repairable: boolean;
}): string {
    return [
        `**pr-refresh: rebase onto \`${input.base}\` is clean but \`${input.check.command}\` fails on the rebased tree** — labelled \`${FAILED_LABEL}\`; the branch was NOT pushed.`,
        "",
        "```",
        input.detail,
        "```",
        "",
        input.repairable
            ? "`queue:plan` hands this PR to the next pass as a repair pick (`/next-ticket <issue> --resume`); after the fix, `bun run land:ready <PR#>` re-queues it."
            : "This branch names no issue, so no pass is handed it: a human repairs it; after the fix, `bun run land:ready <PR#>` re-queues it.",
    ].join("\n");
}
