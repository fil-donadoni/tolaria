/**
 * Which browser walk a health run owes (ADR 0131 amendments, issues #5076,
 * #5378).
 *
 * Batch health no longer walks at all: its batch-scoped plan (issue #5076)
 * came out `full` on every run — any engine or card path reaches the app
 * shell — for 30 walks, 9.2 h of machine time and no UI defect in a week
 * (issue #5378). The PR's own scoped walk catches what a diff breaks; the
 * every-surface backstop is a RELEASE step:
 *
 *   - `--ui-all` (`bun run release` passes it) → `full`;
 *   - anything else                             → `skipped`, no walk at all.
 *
 * A GREEN tip recorded with a skipped walk is walked in full before `release`
 * reads it (`walkWasFull`).
 *
 * Pure and import-free: `health-main.ts` carries the gate's zero-import
 * constraint.
 */

export type WalkPlan =
    | { kind: "skipped"; reason: string }
    | { kind: "full"; reason: string };

/** The walk entry `HEALTH_SCRIPTS` declares, and what `release` forces. */
export const FULL_WALK_ENTRY = "check:ui --all";

export const FORCED_REASON = "forced (--ui-all, release)";

export const SKIPPED_REASON =
    "batch health owes no walk — the full walk is a release step (issue #5378)";

export function planHealthWalk({ forceAll }: { forceAll: boolean }): WalkPlan {
    return forceAll
        ? { kind: "full", reason: FORCED_REASON }
        : { kind: "skipped", reason: SKIPPED_REASON };
}

/** `health:status`'s line, and the `last.json` `walk` text. */
export function describeWalkPlan(plan: WalkPlan): string {
    return `${plan.kind} — ${plan.reason}`;
}

/**
 * Did this GREEN record walk the whole app? `release` (`--ui-all`) trusts
 * only a full walk: a tip batch health proved with a skipped (or, before
 * issue #5378, scoped) walk still owes it. A record from before the batch
 * rule (no `walk` field) was walked full.
 */
export function walkWasFull(record: { ui?: string; walk?: string }): boolean {
    return (
        record.ui === "green" &&
        (record.walk === undefined || record.walk.startsWith("full"))
    );
}
