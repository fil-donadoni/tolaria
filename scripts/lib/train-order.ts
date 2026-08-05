// Merge-train order, computed from the batch's receipts (issue #2185, PRD #2180).
//
// The train used to order PRs by batch priority and then ask the orchestrator to
// NOTICE, by re-reading receipts in its context window, that two PRs met in a
// shared file and needed reordering — "land the PR that restructures the shared
// file first". That is a topological sort performed by prose, on evidence that
// disappears when the context does.
//
// With receipts durable (#2182), it is a function. Three properties matter:
//
//   * PURE — receipts in, order out. No git, no network, no clock. The same
//     batch always merges in the same sequence, and the sequence is assertable.
//   * CONSERVATIVE — an edge is created only where one PR restructures a file
//     another merely touches. Two PRs that both append to the same file get NO
//     edge: the train re-gates every merge anyway, and their rebase conflict is
//     trivial. Over-constraining serialises batches that had no reason to be.
//   * LOUD ON A CYCLE — two PRs that each restructure a file the other touches
//     have no correct order. That is a real signal the batch should not have
//     been parallel, so it is REPORTED rather than broken arbitrarily. An
//     arbitrary resolution here would land a merge sequence nobody chose and
//     nobody could reconstruct afterwards.

import { DEFAULT_APPEND_ONLY_PATHS, pathsOverlap } from "./queue-plan";
import type { WorkReceipt } from "./receipt";

export interface TrainOrderConfig {
    /**
     * Registration points every ticket appends to. Excluded from the conflict
     * graph exactly as they are excluded from batch disjointness: the train
     * absorbs their trivial rebase conflicts by design, and treating them as
     * edges would serialise every batch that ships a card.
     */
    appendOnlyPaths?: string[];
}

/** One ordering constraint, with the evidence that produced it. */
export interface TrainEdge {
    /** Issue number that must merge first (it restructures `path`). */
    before: number;
    /** Issue number that merges after (it touches `path`). */
    after: number;
    path: string;
}

/** Two or more PRs with no correct relative order. */
export interface TrainCycle {
    issues: number[];
    paths: string[];
}

export interface TrainOrder {
    /**
     * Issue numbers in merge order. **Empty when `cycles` is non-empty** — a
     * batch with a cycle has no order this function is willing to invent, and
     * an empty list forces the caller to handle it rather than merge something
     * plausible.
     */
    order: number[];
    edges: TrainEdge[];
    cycles: TrainCycle[];
}

/**
 * Compute the order the train should merge in.
 *
 * `receipts` arrives in the INCOMING priority order (bugs first, then FIFO —
 * whatever the planner decided). That order is preserved wherever the conflict
 * graph has nothing to say, which is the common case: a function that reshuffles
 * a batch it has no opinion about would silently override the planner's
 * priority decision with an artefact of iteration order.
 */
export function computeTrainOrder(
    receipts: WorkReceipt[],
    config: TrainOrderConfig = {}
): TrainOrder {
    const appendOnly = config.appendOnlyPaths ?? DEFAULT_APPEND_ONLY_PATHS;
    const isAppendOnly = (p: string) =>
        appendOnly.some((a) => pathsOverlap(p, a));

    // Only PRs that are actually open can be merged. A wip/failed/collision
    // receipt has nothing to land, and letting it contribute edges would order
    // the train around work that is not in it.
    const mergeable = receipts.filter((r) => r.outcome === "pr-open");
    const priority = new Map(mergeable.map((r, i) => [r.issue, i]));

    const edges: TrainEdge[] = [];
    const cycles: TrainCycle[] = [];

    for (let i = 0; i < mergeable.length; i++) {
        for (let j = i + 1; j < mergeable.length; j++) {
            const a = mergeable[i];
            const b = mergeable[j];
            const shared = a.targetFiles.filter(
                (p) =>
                    !isAppendOnly(p) &&
                    b.targetFiles.some((q) => pathsOverlap(p, q))
            );

            const contested: string[] = [];
            for (const path of shared) {
                const aRestructures = touches(a.restructures, path);
                const bRestructures = touches(b.restructures, path);

                if (aRestructures && bRestructures) {
                    // Neither can safely go second. Recorded as a cycle of two
                    // even though no traversal is needed to see it — the caller
                    // handles one shape, not two.
                    contested.push(path);
                } else if (aRestructures) {
                    edges.push({ before: a.issue, after: b.issue, path });
                } else if (bRestructures) {
                    edges.push({ before: b.issue, after: a.issue, path });
                }
                // Neither restructures: no edge. Both merely modify the file,
                // and the train re-gates each merge against the real post-merge
                // main regardless.
            }

            if (contested.length > 0) {
                cycles.push({
                    issues: [a.issue, b.issue].sort((x, y) => x - y),
                    paths: contested,
                });
            }
        }
    }

    if (cycles.length > 0) {
        return { order: [], edges, cycles };
    }

    const { order, stuck } = topologicalOrder(mergeable, edges, priority);
    if (stuck.length > 0) {
        // A cycle spanning three or more PRs: A restructures a file B touches,
        // B restructures a file C touches, C restructures a file A touches. No
        // pairwise check sees it — only the traversal does.
        return {
            order: [],
            edges,
            cycles: [
                {
                    issues: [...stuck].sort((x, y) => x - y),
                    paths: Array.from(
                        new Set(
                            edges
                                .filter(
                                    (e) =>
                                        stuck.includes(e.before) &&
                                        stuck.includes(e.after)
                                )
                                .map((e) => e.path)
                        )
                    ).sort(),
                },
            ],
        };
    }

    return { order, edges, cycles: [] };
}

/**
 * One receipt per issue: a `fixup` supersedes the `implement` receipt it
 * replaces, regardless of the order they arrive in.
 *
 * The implement receipt describes the branch as it was when review blocked it;
 * the fixup receipt describes what will actually land. Both sit in the batch
 * directory forever, so preferring the wrong one orders the train against a
 * diff that no longer exists.
 *
 * Extracted and exported deliberately: inline, the precedence held only because
 * `10-fixup.json` sorts before `10-implement.json`, which is an alphabetical
 * accident no test could distinguish from the rule.
 */
export function latestWorkReceipts(receipts: WorkReceipt[]): WorkReceipt[] {
    const latest = new Map<number, WorkReceipt>();
    for (const receipt of receipts) {
        const held = latest.get(receipt.issue);
        if (!held || receipt.role === "fixup")
            latest.set(receipt.issue, receipt);
    }
    return Array.from(latest.values());
}

function touches(restructures: string[] | undefined, path: string): boolean {
    return (restructures ?? []).some((p) => pathsOverlap(p, path));
}

/**
 * Kahn's algorithm, with ties broken by incoming priority. `stuck` holds the
 * nodes a cycle left unemitted — empty on a clean sort.
 */
function topologicalOrder(
    receipts: WorkReceipt[],
    edges: TrainEdge[],
    priority: Map<number, number>
): { order: number[]; stuck: number[] } {
    const indegree = new Map<number, number>(receipts.map((r) => [r.issue, 0]));
    const outgoing = new Map<number, number[]>(
        receipts.map((r) => [r.issue, []])
    );
    for (const edge of edges) {
        outgoing.get(edge.before)!.push(edge.after);
        indegree.set(edge.after, (indegree.get(edge.after) ?? 0) + 1);
    }

    const byPriority = (a: number, b: number) =>
        (priority.get(a) ?? 0) - (priority.get(b) ?? 0);

    const ready = receipts
        .map((r) => r.issue)
        .filter((n) => indegree.get(n) === 0)
        .sort(byPriority);
    const order: number[] = [];

    while (ready.length > 0) {
        const next = ready.shift()!;
        order.push(next);
        for (const target of outgoing.get(next) ?? []) {
            const left = (indegree.get(target) ?? 0) - 1;
            indegree.set(target, left);
            if (left === 0) {
                ready.push(target);
                ready.sort(byPriority);
            }
        }
    }

    const emitted = new Set(order);
    return {
        order,
        stuck: receipts.map((r) => r.issue).filter((n) => !emitted.has(n)),
    };
}
