/**
 * The health gate's verdict vocabulary, and the one verdict the TREE is not
 * responsible for (issue #4938).
 *
 * `last.json` is written by `health-main.ts` and read by `health-cadence`,
 * `health-fix` and `release`; they share `HealthStatus` so a new verdict
 * cannot be invisible to one of them.
 *
 * `infra` is a failed step during which the machine entered system sleep. A
 * laptop lid closed on battery suspends every vitest worker; on wake each
 * in-flight test is minutes past its timeout, and the step goes red with
 * nothing wrong in the tree (the RED on a15195d8: four `test:bot` timeouts,
 * one per worker, each ~900 s — the exact length of the sleep `pmset` logged).
 * Such a verdict is unproven, not red: no `RED` marker, no `health:fix`, and
 * the same tip is gated again on the next run.
 *
 * The sleep reading is darwin's `kern.sleeptime` (the last time the system
 * entered sleep). Anywhere it cannot be read, nothing is detected and a
 * failed step stays RED — the reading may only ever downgrade a red that
 * provably overlapped a suspension, never invent one.
 *
 * `infra` is ALSO a `check:ui` step that exited `DEPLOYMENT_DOWN_EXIT`
 * (issue #4943): the local Convex backend did not answer, so the walk never
 * started. 7 of 12 REDs after issue #4913 put `check:ui --all` in the gate
 * were that one line, each raising the marker, blocking `queue:plan` and
 * spawning `health:fix` while nothing in the tree was wrong. The run
 * preflights the same probe (`convexPreflight`) so a down backend costs
 * seconds, not ~40 minutes of gates before the last step learns it.
 *
 * Node builtins plus `lib/convex-reachable.ts` (itself builtins only) —
 * `health-main.ts` carries the same constraint.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_DOWN_EXIT } from "./convex-reachable";

export type HealthStatus = "running" | "green" | "red" | "infra";

/** Why a run is `infra` — the machine, never the tree. */
export type InfraCause = "sleep" | "convex-down";

/** The step name `last.json` records when the preflight found the backend
 *  down before any gate ran. */
export const PREFLIGHT_CONVEX_STEP = "preflight:convex";

/** What to do about each cause — one sentence `last.json` carries as
 *  `reason`, so every reader (`health:status`, `queue:plan`, `loop-drain`)
 *  prints the same instruction. No double quotes: `loop-drain` reads it with
 *  `sed`. */
export const INFRA_REMEDY: Record<InfraCause, string> = {
    sleep: "the machine slept during the step; re-run `bun run health` awake",
    "convex-down":
        "the local Convex backend did not answer; start it with `bun run convex:ensure` (the AFK loop's next pass does), then the next health run re-gates the tip",
};

/** `{ sec = 1790866381, usec = 538510 } Thu Oct  1 …` → epoch ms, or null. */
export function parseKernSleeptime(out: string): number | null {
    const m = /\{\s*sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)\s*\}/.exec(out);
    if (!m) return null;
    const sec = Number(m[1]);
    // A machine that never slept since boot reports sec = 0.
    if (sec === 0) return null;
    return sec * 1000 + Math.floor(Number(m[2]) / 1000);
}

/** When the machine last entered system sleep (epoch ms), or null when the
 *  platform does not say. */
export function readLastSleepAt(): number | null {
    if (process.platform !== "darwin") return null;
    const r = spawnSync("sysctl", ["-n", "kern.sleeptime"], {
        encoding: "utf8",
    });
    if (r.status !== 0) return null;
    return parseKernSleeptime(r.stdout);
}

export interface StepOutcome {
    ok: boolean;
    startedAt: number;
    lastSleepAt: number | null;
    /** The `HEALTH_SCRIPTS` entry (`check:ui --all`). */
    step?: string;
    /** The child's exit code; null when a signal killed it. */
    exitCode?: number | null;
}

/** Why a FAILED step is not the tree's fault, or null when it is. The
 *  deployment-down code counts only on the `check:ui` step: another script
 *  exiting 3 says nothing about the backend. */
export function infraCause(input: StepOutcome): InfraCause | null {
    if (input.ok) return null;
    if (
        input.exitCode === DEPLOYMENT_DOWN_EXIT &&
        (input.step ?? "").split(/\s+/)[0] === "check:ui"
    )
        return "convex-down";
    if (input.lastSleepAt !== null && input.lastSleepAt >= input.startedAt)
        return "sleep";
    return null;
}

/**
 * The verdict on one gate step. A step that passed is green whatever the
 * machine did — its tests ran to completion. A step that failed is `infra`
 * only when `infraCause` names a cause: the machine entered sleep at or after
 * the step started, or `check:ui` found the deployment down.
 */
export function stepVerdict(input: StepOutcome): "green" | "red" | "infra" {
    if (input.ok) return "green";
    return infraCause(input) === null ? "red" : "infra";
}

/**
 * The preflight (issue #4943): before any gate runs, ask the deployment
 * `check:ui` will need — the same probe it makes. `convex-down` when the run
 * includes a `check:ui` step, a URL is configured, and it does not answer;
 * otherwise null and the gates run. No URL is left to `check:ui` to report:
 * a missing configuration is not a down backend.
 */
export async function convexPreflight(input: {
    gates: readonly string[];
    url: string | undefined;
    probe: (url: string) => Promise<boolean>;
}): Promise<InfraCause | null> {
    const needsBackend = input.gates.some(
        (g) => g.split(/\s+/)[0] === "check:ui"
    );
    if (!needsBackend || !input.url) return null;
    return (await input.probe(input.url)) ? null : "convex-down";
}

/** The `last.json` fields this module reasons about. */
export interface HealthRecordLike {
    sha: string;
    status: HealthStatus;
}

/**
 * What an INFRA run leaves in `last.json`. Normally its own record. But while
 * a `RED` marker still stands, the record must stay the red one the marker
 * names: an infra run proves nothing, so it may not replace the evidence
 * `health:fix` and `land` read (`health:fix` refuses anything but RED — it
 * would answer "nothing to fix" with the marker still up).
 */
export function infraRecordToKeep<R extends HealthRecordLike>(input: {
    infra: R;
    previous: R | null;
    redMarkerStanding: boolean;
}): R {
    const { infra, previous, redMarkerStanding } = input;
    if (redMarkerStanding && previous?.status === "red") return previous;
    return infra;
}

/**
 * Leave an INFRA verdict in `dir`: `last.json` per `infraRecordToKeep`, and
 * the `RED` marker untouched — neither written (the tree is not red) nor
 * cleared (an infra run proves nothing about a standing red).
 */
export function recordInfra<R extends HealthRecordLike>(input: {
    dir: string;
    infra: R;
    previous: R | null;
    redMarkerStanding: boolean;
}): R {
    const kept = infraRecordToKeep(input);
    writeFileSync(join(input.dir, "last.json"), JSON.stringify(kept, null, 2));
    return kept;
}

/** The `last.json` fields an INFRA notice prints. */
export interface InfraRecord {
    sha?: string;
    failedStep?: string;
    reason?: string;
}

/** One line for a reader that is NOT stopped by an INFRA verdict
 *  (`queue:plan`; `loop-drain` composes the same line in sh): the tip is
 *  unproven, not red, and here is what to do. */
export function infraNotice(r: InfraRecord): string {
    const sha = r.sha ? r.sha.slice(0, 8) : "unknown sha";
    return `release health is INFRA @ ${sha} (at ${r.failedStep ?? "unknown step"}) — the tip is unproven, not red: ${r.reason ?? "re-run `bun run health`"}`;
}
