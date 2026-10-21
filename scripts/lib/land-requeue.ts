/**
 * The decisions behind `land:ready`'s re-queue of a PR on an unchanged head
 * (issue #6163). Mergify's `queue-dequeue-reason` is sticky: it keeps the
 * PR's LAST dequeue reason until the PR is queued again or its head changes,
 * so relabelling `ready-to-land` alone re-fires `.mergify.yml`'s "a PR the
 * queue rejects is a repair pick" within seconds. The way out is Mergify's
 * own `@mergifyio requeue` (`REQUEUE_COMMENT`, shared with `pr-gate`'s
 * GREEN-side requeue, issue #6110). Pure; `land-ready.ts` is the I/O.
 */
import { FAILED_LABEL, READY_LABEL } from "./land-runner";
import { MERGIFY_QUEUED_LABEL } from "./pr-gate";

export interface PrComment {
    author: { login: string };
    body: string;
    createdAt: string;
}

/**
 * When Mergify last dequeued the PR, read off its dequeue comment ("merge
 * queue: dequeued …", the rule's or Mergify's own); null when there is none.
 */
export function lastDequeueAt(comments: readonly PrComment[]): string | null {
    const stamps = comments
        .filter(
            (c) => /mergify/i.test(c.author.login) && /dequeued/i.test(c.body)
        )
        .map((c) => c.createdAt)
        .sort();
    return stamps.at(-1) ?? null;
}

/**
 * Whether the hand-off must post the requeue comment: the PR goes to the
 * queue, was dequeued at least once, and the dequeue is not older than its
 * head (a newer head already reset the reason). ISO-8601 stamps compare
 * lexically.
 */
export function needsDequeueRequeue(input: {
    toQueue: boolean;
    lastDequeueAt: string | null;
    headCommittedAt: string;
}): boolean {
    return (
        input.toQueue &&
        input.lastDequeueAt !== null &&
        input.lastDequeueAt >= input.headCommittedAt
    );
}

export type HandOffVerdict = "queued" | "relabelled-failed" | "pending";

/** What the labels, read back after the hand-off, say about it. */
export function readBackVerdict(labels: readonly string[]): HandOffVerdict {
    if (labels.includes(FAILED_LABEL)) return "relabelled-failed";
    if (labels.includes(MERGIFY_QUEUED_LABEL) && labels.includes(READY_LABEL))
        return "queued";
    return "pending";
}
