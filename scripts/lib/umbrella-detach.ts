// Detach a landed issue from its band umbrella once it is closed (issue #4235).
//
// A band umbrella (`BAND_UMBRELLAS`, `KIND_FALLBACK` in `lib/gap-issues.ts`) is
// "a bounded, ordered slice of the backlog" (issue #4056): it should list the
// OPEN work of its band. A child that landed and closed only clutters it, and
// the umbrella's board `Priority` is inherited by every child (issue #3212), so
// a closed child is a row that no longer means anything. Until this step the
// closed children were removed by hand.
//
// The rule is a fact about the edge, not about the branch: the parent must be
// a CENSUSED umbrella and the child must be CLOSED. Both are read from GitHub
// at the moment the step runs, so the order `land` runs it in is what makes it
// right — after `gaps:sync` (which reads the parent edge for its band) and
// after the merge has had the chance to close the issue.
//
// An issue still OPEN is NEVER detached: the `Closes #N` keyword can fail to
// close (`feedback_closes_issue_keyword_needs_bare_ref`), and detaching an
// open issue would silently drop live work out of the queue's band. The
// outcome says so, and names the command to re-run once it is closed by hand.
//
// NON-GATING by contract, like every other post-merge step of `land`: every
// failure is an outcome the caller prints, never a throw.

import { gh } from "./gh";
import { BAND_UMBRELLAS, KIND_FALLBACK } from "./gap-issues";

/** Every umbrella a landed child is detached from — the live partition. */
export function censusedUmbrellas(): ReadonlySet<number> {
    const census = new Set<number>(Object.values(KIND_FALLBACK));
    for (const bands of Object.values(BAND_UMBRELLAS))
        for (const umbrella of Object.values(bands)) census.add(umbrella);
    return census;
}

export interface IssueEdge {
    /** The issue's database id — what the sub-issue REST endpoint takes. */
    readonly id: number;
    readonly state: "open" | "closed";
    /** The native parent's number, or null. */
    readonly parent: number | null;
}

export interface DetachDeps {
    /** May throw. */
    readIssue: (issue: number) => IssueEdge;
    /** Remove `childId` from `parent`'s sub-issues. May throw. */
    removeSubIssue: (parent: number, childId: number) => void;
}

export type DetachOutcome =
    | { readonly kind: "detached"; readonly parent: number }
    | { readonly kind: "no-parent" }
    | { readonly kind: "not-censused"; readonly parent: number }
    | { readonly kind: "open"; readonly parent: number }
    | { readonly kind: "failed"; readonly reason: string };

/**
 * Detach `issue` from its parent when the parent is a censused umbrella and
 * the issue is closed. The edge is read back before it is called removed: the
 * REST call is trusted no further than `setIssueParent` trusts `gh issue edit`.
 */
export function detachFromUmbrella(
    issue: number,
    deps: DetachDeps,
    census: ReadonlySet<number> = censusedUmbrellas()
): DetachOutcome {
    let edge: IssueEdge;
    try {
        edge = deps.readIssue(issue);
    } catch (err) {
        return {
            kind: "failed",
            reason: `could not read issue #${issue} (${(err as Error).message})`,
        };
    }
    if (edge.parent === null) return { kind: "no-parent" };
    if (!census.has(edge.parent))
        return { kind: "not-censused", parent: edge.parent };
    if (edge.state !== "closed") return { kind: "open", parent: edge.parent };
    try {
        deps.removeSubIssue(edge.parent, edge.id);
        const after = deps.readIssue(issue);
        if (after.parent === edge.parent)
            return {
                kind: "failed",
                reason: `issue #${issue} is still under #${edge.parent} after the removal`,
            };
    } catch (err) {
        return {
            kind: "failed",
            reason: `could not remove issue #${issue} from #${edge.parent} (${(err as Error).message})`,
        };
    }
    return { kind: "detached", parent: edge.parent };
}

/** One printable line per outcome — the caller decides the stream. */
export function describeOutcome(issue: number, outcome: DetachOutcome): string {
    switch (outcome.kind) {
        case "detached":
            return `umbrella:detach: issue #${issue} removed from umbrella #${outcome.parent}`;
        case "no-parent":
            return `umbrella:detach: issue #${issue} has no parent — nothing to do`;
        case "not-censused":
            return `umbrella:detach: issue #${issue}'s parent #${outcome.parent} is not a band umbrella — left alone`;
        case "open":
            return `umbrella:detach: issue #${issue} is still OPEN under umbrella #${outcome.parent} — not detached; close it, then run \`bun run umbrella:detach ${issue}\``;
        case "failed":
            return `umbrella:detach: ${outcome.reason}`;
    }
}

/** The reads and writes over a `gh` client — the REST issue object and the
 *  sub-issue endpoint. `gh` is a parameter so a test can pin the payload shape
 *  and the DELETE arguments without a network. */
export function makeDetachDeps(
    ghClient: (args: string[]) => string = gh
): DetachDeps {
    return {
        readIssue(issue) {
            const raw = ghClient([
                "api",
                `repos/{owner}/{repo}/issues/${issue}`,
                "--jq",
                "{id, state, parent_issue_url}",
            ]);
            const j = JSON.parse(raw) as {
                id?: number;
                state?: string;
                parent_issue_url?: string | null;
            };
            if (
                typeof j.id !== "number" ||
                (j.state !== "open" && j.state !== "closed")
            )
                throw new Error(
                    `unexpected issue payload ${JSON.stringify(j)}`
                );
            const parent = j.parent_issue_url?.match(/\/issues\/(\d+)$/)?.[1];
            return {
                id: j.id,
                state: j.state,
                parent: parent === undefined ? null : Number(parent),
            };
        },
        removeSubIssue(parent, childId) {
            ghClient([
                "api",
                "--method",
                "DELETE",
                `repos/{owner}/{repo}/issues/${parent}/sub_issue`,
                "-F",
                `sub_issue_id=${childId}`,
            ]);
        },
    };
}

export const LIVE_DETACH_DEPS: DetachDeps = makeDetachDeps();
