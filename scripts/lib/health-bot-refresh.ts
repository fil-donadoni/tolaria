/**
 * The Bot Findings refresh a health batch owes (ADR 0141 § 5, issue #4181).
 *
 * The admin page's measurement (`data/bot-reach-findings.json`) is re-taken by
 * the health batch, and ONLY when that batch's diff touched the Bot's globs —
 * `land` and `check:pr` never pay it (265 s of CPU on a shared machine), and a
 * batch that left the Bot alone would re-measure verdicts it cannot have moved.
 * This module is the DECISION and the steps; `health-main.ts` runs them.
 *
 * Kept apart from `health-main.ts` because that script runs `main()` on load
 * and so cannot be imported by a test. Node builtins and `bot-globs.ts` (itself
 * import-free) only — `health-main.ts`'s own constraint.
 */
import { touchesBotGlobs } from "./bot-globs";
import type { HealthStep } from "./health-step";

/** Where the refreshed artifact is kept for whoever commits it: the primary
 *  checkout's health dir, beside `last.json`. */
export const REFRESHED_ARTIFACT_NAME = "bot-reach-findings.json";

/**
 * Did the batch touch the Bot? `changed` is the repo-relative paths between the
 * last green tip and this one, or `null` when that diff could not be taken
 * (no green tip recorded, or it is no longer reachable): an unknown diff
 * measures — the artifact's own cache makes an untouched Bot cost seconds, and
 * a page silently left stale is the failure this exists to prevent.
 */
export function batchTouchesBot(changed: readonly string[] | null): boolean {
    return changed === null || touchesBotGlobs(changed);
}

/**
 * The two steps of a refresh, numbered after the `gates` already planned:
 * re-measure, then seed the deployment from the artifact just written.
 *
 * `bot:reach` goes through the heavy gate like every CPU-bound step — under the
 * batch's own hold (`--under-lock`) it passes straight through, and a by-hand
 * `bun run health` queues on the mutex instead of racing a `land`.
 */
export function botRefreshSteps(gates: number): HealthStep[] {
    const total = gates + 2;
    return [
        {
            ordinal: gates + 1,
            total,
            name: "bot:reach",
            cmd: "bun",
            args: ["scripts/gate.ts", "heavy", "bun run bot:reach"],
        },
        {
            ordinal: gates + 2,
            total,
            name: "seed:bot-findings",
            cmd: "bun",
            args: ["run", "seed:bot-findings"],
        },
    ];
}
