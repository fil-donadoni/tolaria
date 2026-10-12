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
