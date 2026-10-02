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
 * `infra` is ALSO a browser walk the ENVIRONMENT cut short (issue #4962):
 * `check:ui` exiting 2 (a fatal error before any surface was judged — the
 * sign-in the auth backend refused on aa785cf0), or exiting 1 with every
 * failing row the machine's (`walkRunVerdict`, `ui-gate/infra-verdict.ts`).
 * And until the walk has earned `UI_WALK_PROBATION_RUNS` consecutive
 * non-infra verdicts (`uiWalkArmed`), even a walk the tree failed is recorded
 * `infra` with cause `ui-unproven` — `ui: unproven` in `health:status` —
 * never a RED marker: nine of its first ten verdicts were environment, and a
 * gate that has not yet shown it can tell the two apart may not stop the
 * queue. `release` reads only `green`, so it still requires the walk to pass.
 *
 * Node builtins plus `lib/convex-reachable.ts` (itself builtins only) and
 * `ui-gate/infra-verdict.ts` (which adds only `lib/convex-reachable.ts`) — `health-main.ts` carries the same
 * constraint.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_DOWN_EXIT } from "./convex-reachable";
import { walkRunVerdict } from "../ui-gate/infra-verdict";

export type HealthStatus = "running" | "green" | "red" | "infra";

/** Why a run is `infra` — the machine, never the tree. */
export type InfraCause = "sleep" | "convex-down" | "ui-walk" | "ui-unproven";

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
    "ui-walk":
        "the browser walk was cut short by the environment (a fatal check:ui error, or every failing row INFRA); the next health run re-walks the tip",
    "ui-unproven":
        "the browser walk failed while still in probation, so it raises no RED marker; read the log, and the next health run re-walks the tip",
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
    /** The child's stdout + stderr — read for a `check:ui` step only. */
    output?: string;
}

/** The `HEALTH_SCRIPTS` entry's script name: `check:ui --all` → `check:ui`. */
function scriptOf(step: string | undefined): string {
    return (step ?? "").split(/\s+/)[0];
}

/** Whether a `HEALTH_SCRIPTS` entry is the browser walk. */
export function isWalkStep(step: string | undefined): boolean {
    return scriptOf(step) === "check:ui";
}

/** Why a FAILED step is not the tree's fault, or null when it is. The
 *  deployment-down code counts only on the `check:ui` step: another script
 *  exiting 3 says nothing about the backend. */
export function infraCause(input: StepOutcome): InfraCause | null {
    if (input.ok) return null;
    const walk = isWalkStep(input.step);
    if (walk && input.exitCode === DEPLOYMENT_DOWN_EXIT) return "convex-down";
    if (input.lastSleepAt !== null && input.lastSleepAt >= input.startedAt)
        return "sleep";
    if (
        walk &&
        walkRunVerdict(input.exitCode ?? null, input.output ?? "") === "infra"
    )
        return "ui-walk";
    return null;
}

/**
 * The verdict on one gate step. A step that passed is green whatever the
 * machine did — its tests ran to completion. A step that failed is `infra`
 * only when `infraCause` names a cause: the machine entered sleep at or after
 * the step started, `check:ui` found the deployment down, or the walk's own
 * receipt says the environment cut it short.
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

/**
 * The browser walk's probation (issue #4962). A walk failure writes the RED
 * marker only once the walk has shown `UI_WALK_PROBATION_RUNS` consecutive
 * non-infra verdicts (a pass, or a failure the tree owns) — before that it is
 * recorded `infra` / `ui-unproven`. Any infra walk restarts the count: a gate
 * whose environment still fails it is not yet a gate that can stop the queue.
 */
export const UI_WALK_PROBATION_RUNS = 5;

/** The probation ledger, `ui-walk.json` beside `last.json`. */
export const UI_WALK_FILE = "ui-walk.json";

export interface UiWalkLedger {
    /** Consecutive non-infra walk verdicts, the latest included. */
    streak: number;
}

/** What one walk's verdict was, for the ledger. */
export type WalkOutcome = "green" | "red" | "infra";

export function parseUiWalkLedger(text: string | null): UiWalkLedger {
    try {
        const v = JSON.parse(text ?? "") as { streak?: unknown };
        const n = v.streak;
        return {
            streak:
                typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0,
        };
    } catch {
        return { streak: 0 };
    }
}

/** The ledger after one walk: infra restarts it, anything else extends it. */
export function nextUiWalkLedger(
    ledger: UiWalkLedger,
    outcome: WalkOutcome
): UiWalkLedger {
    return { streak: outcome === "infra" ? 0 : ledger.streak + 1 };
}

/** Whether a walk failure may write the RED marker: the walk has served its
 *  probation BEFORE this run. */
export function uiWalkArmed(ledger: UiWalkLedger): boolean {
    return ledger.streak >= UI_WALK_PROBATION_RUNS;
}

/**
 * The verdict a FAILED walk step stands as: `infraCause` when the environment
 * cut it short, `ui-unproven` when the tree failed it during probation, and
 * null — a RED — only once the walk is armed.
 */
export function walkFailureCause(
    cause: InfraCause | null,
    ledger: UiWalkLedger
): InfraCause | null {
    if (cause !== null) return cause;
    return uiWalkArmed(ledger) ? null : "ui-unproven";
}

/** The walk's state as `health:status` prints it, separately from the
 *  offline verdict. */
export type UiWalkState =
    | "green"
    | "red"
    | "infra"
    | "unproven"
    | "pending"
    | "not run";

export function uiWalkStateOf(
    outcome: WalkOutcome,
    cause: InfraCause | null
): UiWalkState {
    if (outcome === "green") return "green";
    if (cause === "ui-unproven") return "unproven";
    return cause === null ? "red" : "infra";
}
