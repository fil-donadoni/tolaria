/**
 * The hand-off's PR labels (issue #5469) — a LEAF module, no imports:
 * `lib/claim-verdict.ts` and two dozen other readers take them, so none of
 * them pulls the hand-off's decisions (`lib/queue-hand-off.ts`) or, through
 * them, `pr-gate`.
 */

/** The label a session puts on its PR to hand it to the merge queue. */
export const READY_LABEL = "ready-to-land";
/** The label put on a PR whose landing went red (the queue, `pr-refresh`). */
export const FAILED_LABEL = "land-failed";
/** The merge queue's hold marker (issue #6110): `.mergify.yml` puts it on a
 *  PR dequeued under a red `base-health`, so the repair-pick rule keeps
 *  standing down after the GREEN; `pr-gate` removes it when it requeues. */
export const HELD_LABEL = "queue:held";
/** The exception marker (issue #6213, was `queue:shadow`): a `ready-to-land`
 *  PR the Mergify queue refuses, which the owner merges by hand. `land:ready`
 *  adds it when the queue would not admit the PR (issue #5952); a queue PR
 *  carries no marker, and `pr-refresh` treats every
 *  `ready-to-land` PR without it as the queue's. */
export const MANUAL_LABEL = "merge:manual";
