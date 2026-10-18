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
/** The shadow-phase label (issue #5642, ADR 0156 Phase 1): a `ready-to-land`
 *  PR carrying it is the Mergify queue's, and the runner skips it. Since
 *  issue #5952 `land:ready` adds it to every PR the queue admits; removing
 *  it hands the PR back to the runner. */
export const SHADOW_LABEL = "queue:shadow";

/**
 * Whether the Mergify queue can admit a PR with these changed paths: the two
 * path exclusions of `.mergify.yml`'s `queue_conditions` (`-files~=^\.github/`,
 * `-files=.mergify.yml`), pinned there by the structure guard's `queue-entry`
 * rule. A PR the queue refuses stays the land-runner's — labelled
 * `queue:shadow`, it would have no merger at all.
 */
export function queueAdmits(paths: readonly string[]): boolean {
    return !paths.some((p) => p.startsWith(".github/") || p === ".mergify.yml");
}
