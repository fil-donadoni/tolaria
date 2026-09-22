// Orphaned sub-issues — an open child whose native parent was closed as
// `not planned` (issue #4105).
//
// GitHub has no cascade: closing a parent leaves every native sub-issue open
// and still parented. That state used to mean two opposite things in this
// repo, so nothing could act on it:
//
//   * a LIVE survivor slice — `/audit-tracker` wired every slice to the
//     tracker and then closed the tracker as `not planned` ("the work isn't
//     done, it moved"), or
//   * DEAD work — somebody abandoned a PRD and its children stayed in the
//     queue (issue #3016 is the observed case: `ready-for-agent`, on the
//     board, parent `CLOSED / NOT_PLANNED`, and obsolete).
//
// `/audit-tracker` Phase 7 now keeps a tracker with live children OPEN as a
// retired umbrella, so the signal is unambiguous at the source and this
// module can act on it: an open child under a `CLOSED / NOT_PLANNED` parent
// is ABANDONED.
//
// Two consumers, ONE predicate — the queue planner's pick refusal
// (`lib/queue-plan.ts`) and the sweep (`scripts/issues-orphans.ts`). A second
// spelling of "abandoned" is how the refusal and the sweep would come to
// disagree about which issues they are talking about.

/** An issue's lifecycle state, as `gh --json state` spells it. */
export type IssueState = "OPEN" | "CLOSED";

/**
 * Why an issue is closed, as `gh --json stateReason` spells it. `null` for an
 * open issue, and for a closed one GitHub never attributed — the API has
 * returned `null` there historically, so it is a real value, not an absence.
 */
export type StateReason = "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;

/** The parent's lifecycle, resolved. */
export interface ParentState {
    state: IssueState;
    stateReason: StateReason;
}

/**
 * The one definition of "this parent's closure means the work was
 * ABANDONED".
 *
 * `COMPLETED` is deliberately NOT abandoned: a discharged umbrella that
 * closed with a child still open is a bookkeeping slip, and stalling that
 * child — or sweeping it closed — would destroy live work over a mis-picked
 * close reason. `NOT_PLANNED` is the only reason a human chooses when the
 * work is being dropped, and after the `/audit-tracker` fix it is no longer
 * chosen for a tracker that still has survivors.
 */
export function parentIsAbandoned(parent: ParentState | null): boolean {
    return (
        parent !== null &&
        parent.state === "CLOSED" &&
        parent.stateReason === "NOT_PLANNED"
    );
}

/** An open issue as the sweep sees it —
 *  `gh issue list --json number,title,parent,labels,assignees`. */
export interface SweepIssue {
    number: number;
    title: string;
    parent: { number: number; state?: string } | null;
    /** REQUIRED, like `QueueParent.state`: the sweep can CLOSE things, and a
     *  claim field a caller may omit degrades the hold-back below to "unless
     *  somebody forgot to ask for labels". `tsc` is the enforcement. */
    labels: { name: string }[];
    assignees: { login: string }[];
}

/**
 * Who is holding this issue right now, as a phrase to print — `null` when
 * nobody is.
 *
 * The invariant the whole feature rests on ("a `NOT_PLANNED` parent means
 * abandoned") is upheld by CONVENTION: `/audit-tracker` Phase 7 keeps a
 * tracker with survivors open, but nothing stops a maintainer closing a
 * tracker as `not planned` from the GitHub UI while a child is genuinely
 * mid-flight. So the sweep mirrors `planBatch`'s Stage-1 filter — the picker
 * diverts every `in-progress` and assigned issue before the orphan check ever
 * runs, and a sweep that did not would close a live issue out from under the
 * session working it.
 */
export function claimOf(issue: SweepIssue): string | null {
    if (issue.labels.some((l) => l.name === "in-progress")) {
        return "in-progress";
    }
    const assignees = issue.assignees.map((a) => a.login);
    return assignees.length > 0 ? `assigned to ${assignees.join(", ")}` : null;
}

/** One orphan, ready to print or to close. */
export interface Orphan {
    number: number;
    title: string;
    parent: number;
    /** `claimOf` — printed on the row, and what holds the issue back from
     *  `--close`. */
    claim: string | null;
}

/**
 * The orphans in `issues`, given a resolver for the parents' lifecycles.
 *
 * PURE and TOTAL over its input: every issue with a parent is either an
 * orphan or it is not, and a parent the resolver cannot speak for
 * (`undefined`) is NOT an orphan. That direction is the safe one — a failed
 * read must never close somebody's live slice — and it is why the resolver
 * returns `undefined` for "I don't know" rather than a synthesized
 * `{ state: "CLOSED" }`.
 *
 * The resolver is injected because the sweep's own cost is the interesting
 * part: one `gh` round-trip per DISTINCT parent, not per issue.
 */
export function orphanedIssues(
    issues: readonly SweepIssue[],
    parentState: (parent: number) => ParentState | undefined
): Orphan[] {
    const out: Orphan[] = [];
    for (const issue of issues) {
        if (issue.parent == null) continue;
        const state = parentState(issue.parent.number);
        if (state === undefined) continue;
        if (!parentIsAbandoned(state)) continue;
        out.push({
            number: issue.number,
            title: issue.title,
            parent: issue.parent.number,
            claim: claimOf(issue),
        });
    }
    return out;
}

/**
 * The distinct parents `issues` name — the sweep's read set.
 *
 * Split out so the round-trip count is assertable: a sweep that resolved a
 * parent per ISSUE would make 400 calls over a queue of 400 children of one
 * abandoned epic, and nothing about its output would look different.
 */
export function distinctParents(issues: readonly SweepIssue[]): number[] {
    const seen = new Set<number>();
    for (const issue of issues) {
        if (issue.parent != null) seen.add(issue.parent.number);
    }
    return [...seen].sort((a, b) => a - b);
}

/**
 * `--close`'s two piles: the orphans it may close, and the ones a live claim
 * holds back.
 *
 * A partition, not a filter, because the held ones must still be REPORTED —
 * an orphan silently dropped from the sweep is the state issue #3016 sat in,
 * one convention removed.
 */
export function partitionForClose(orphans: readonly Orphan[]): {
    closable: Orphan[];
    held: Orphan[];
} {
    return {
        closable: orphans.filter((o) => o.claim === null),
        held: orphans.filter((o) => o.claim !== null),
    };
}

/** The comment the sweep leaves when it closes an orphan — named here so the
 *  text is part of the tested surface, not a string buried in an argv branch. */
export function orphanCloseComment(orphan: Orphan): string {
    return (
        `Closing as \`not planned\`: this issue's native parent #${orphan.parent} ` +
        `is closed as \`not planned\`, which after issue #4105 means the work was ` +
        `ABANDONED rather than moved (a tracker with live slices now stays OPEN as ` +
        `a retired umbrella — see \`.claude/skills/audit-tracker/SKILL.md\` Phase 7).\n\n` +
        `If this slice is still live, reopen it and re-parent it to an open umbrella.`
    );
}
