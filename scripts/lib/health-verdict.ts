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
 * Node builtins only — `health-main.ts` carries the same constraint.
 */
import { spawnSync } from "node:child_process";

export type HealthStatus = "running" | "green" | "red" | "infra";

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

/**
 * The verdict on one gate step. A step that passed is green whatever the
 * machine did — its tests ran to completion. A step that failed is `infra`
 * only when the machine entered sleep at or after the step started.
 */
export function stepVerdict(input: {
    ok: boolean;
    startedAt: number;
    lastSleepAt: number | null;
}): "green" | "red" | "infra" {
    if (input.ok) return "green";
    if (input.lastSleepAt !== null && input.lastSleepAt >= input.startedAt)
        return "infra";
    return "red";
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
