/**
 * The land-runner's two PR labels (issue #5469) — a LEAF module, no imports:
 * `loop-doctor.ts` reads them and the dashboard's program imports
 * `loop-doctor.ts`, so pulling `lib/land-runner.ts` (and through it the
 * health ledger and the UI gate) into that program is a cost nobody asked for.
 */

/** The label a session puts on its PR to hand it to the runner. */
export const READY_LABEL = "ready-to-land";
/** The label the runner puts on a PR whose `land` went red. */
export const FAILED_LABEL = "land-failed";
/** The merge queue's hold marker (issue #6110): `.mergify.yml` puts it on a
 *  PR dequeued under a red `base-health`, so the repair-pick rule keeps
 *  standing down after the GREEN; `pr-gate` removes it when it requeues. */
export const HELD_LABEL = "queue:held";
/** The shadow-phase label (issue #5642, ADR 0156 Phase 1): a `ready-to-land`
 *  PR carrying it is the Mergify queue's, and the runner skips it.
 *  `land:ready` adds it when the queue would admit the PR (issue #5952). */
export const SHADOW_LABEL = "queue:shadow";
