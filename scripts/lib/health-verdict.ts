/**
 * The health gate's verdict vocabulary, and the one verdict the TREE is not
 * responsible for (issue #4938).
 *
 * `last.json` is written by `health-main.ts` and read by `health-fix`
 * and `release`; they share `HealthStatus` so a new verdict
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
 * `infra` is ALSO a browser step that exited `DEPLOYMENT_DOWN_EXIT` (issue
 * #4943): the local Convex backend did not answer, so the step never started.
 * 7 of 12 REDs after issue #4913 put `check:ui --all` in the gate were that
 * one line, each raising the marker, blocking `queue:plan` and spawning
 * `health:fix` while nothing in the tree was wrong. A run that owes a browser
 * step preflights the same probe (`convexPreflight`) so a down backend costs
 * seconds, not ~40 minutes of gates before the last step learns it.
 *
 * `infra` is ALSO a browser step the ENVIRONMENT cut short (issue #4962):
 * exiting 2 (a fatal error before anything was measured — a sign-in the auth
 * backend refused), or exiting 1 with every failing row `INFRA`
 * (`walkRunVerdict`, `ui-gate/infra-verdict.ts`). One the TREE failed is RED.
 * Since issue #6143 the one browser step is `check:game-download`, at
 * `release`: no automated run walks `check:ui` any more.
 *
 * `infra` is ALSO a gate that never started (`INFRA_EXIT` → `gate-not-run`):
 * the dependency install failed, so nothing ran.
 *
 * `infra` is ALSO a browser step facing a deployment that serves code other
 * than the tip (issues #6132, #6133, `lib/deployment-skew.ts`): `convex dev`
 * pushes the PRIMARY checkout, and a primary moved off the base branch fails
 * a green tip's browser steps. The browser phase preflights it
 * (`PREFLIGHT_SKEW_STEP`) → `deployment-skew`.
 *
 * Node builtins plus `lib/convex-reachable.ts` (builtins only),
 * `ui-gate/infra-verdict.ts` (which adds only it and `lib/deployment-skew.ts`,
 * builtins only) and
 * `lib/infra-exit.ts` (builtins plus `lib/branches.ts`) —
 * `health-main.ts` carries the same constraint.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_DOWN_EXIT } from "./convex-reachable";
import { walkRunVerdict } from "../ui-gate/infra-verdict";
import { INFRA_EXIT } from "./infra-exit";

/**
 * `pending` (ADR 0157 § Option 1b, "Health", issue #6248): the tip is
 * derived-stale — its lockfile header hashes or `data/catalogue/*` are not
 * what the tree generates — within the grace `derive:sync` has to write them
 * (`DERIVED_GRACE_MS`, `lib/health-step.ts`). Nothing was gated: not a
 * verdict, never the store's, never a `RED` marker; the derive commit's own
 * push brings the next tip, and the next run re-judges this one — stale past
 * the grace is RED at step `derive:sync`.
 */
export type HealthStatus = "running" | "green" | "red" | "infra" | "pending";

/** The step name `last.json` records when the tip's derived state decided
 *  the run (ADR 0157): `pending` within the grace, RED past it. */
export const DERIVE_STEP = "derive:sync";

/** Why a run is `infra` — the machine, never the tree. */
export type InfraCause =
    | "sleep"
    | "convex-down"
    /** A browser step the environment cut short (`walkRunVerdict`). */
    | "browser-step"
    /** A gate never started (a failed dependency install): nothing ran. */
    | "gate-not-run"
    /** The deployment served code other than the tip (issue #6132). */
    | "deployment-skew";

/** The step name `last.json` records when the preflight found the backend
 *  down before any gate ran. */
export const PREFLIGHT_CONVEX_STEP = "preflight:convex";

/** The step name `last.json` records when the browser phase found the
 *  deployment serving code other than the tip before any browser started
 *  (issue #6132). */
export const PREFLIGHT_SKEW_STEP = "preflight:deployment-skew";

/** What to do about each cause — one sentence `last.json` carries as
 *  `reason`, so every reader (`health:status`, `queue:plan`, a shell driver)
 *  prints the same instruction. No double quotes: a shell driver reads it with
 *  `sed`. */
export const INFRA_REMEDY: Record<InfraCause, string> = {
    sleep: "the machine slept during the step; re-run `bun run health` awake",
    "convex-down":
        "the local Convex backend did not answer; start it with `bun run convex:ensure` (the AFK loop's next pass does), then the next health run re-gates the tip",
    "browser-step":
        "a browser step was cut short by the environment (a fatal exit, or every failing row INFRA); the next release re-runs it",
    "gate-not-run":
        "a gate could not start (the dependency install failed), so nothing ran; the next health run re-gates the tip",
    "deployment-skew":
        "the local Convex deployment serves the primary checkout, and the primary is off the base branch, dirty under convex/, or does not contain the tip; put the primary back on the base branch (`git -C <primary> switch <base> && git -C <primary> merge --ff-only origin/<base>`), wait for convex dev to push, and re-run `release`",
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

/** systemd's sleep units — every way a Linux machine suspends. */
export const SYSTEMD_SLEEP_UNITS = [
    "systemd-suspend.service",
    "systemd-hibernate.service",
    "systemd-hybrid-sleep.service",
    "systemd-suspend-then-hibernate.service",
];

/** `journalctl -o short-unix` → the epoch ms of its LAST line, or null.
 *  `1790866381.538510 host systemd[1]: Starting System Suspend...` */
export function parseJournalLastUnix(out: string): number | null {
    const lines = out.trim().split("\n");
    const m = /^(\d+)\.(\d{1,6})\s/.exec(lines[lines.length - 1] ?? "");
    if (!m) return null;
    return Number(m[1]) * 1000 + Math.floor(Number(m[2].padEnd(6, "0")) / 1000);
}

/** When the machine last entered system sleep (epoch ms), or null when the
 *  platform does not say. macOS: `kern.sleeptime`. Linux (issue #5305): the
 *  latest journal entry of a systemd sleep unit this boot — its "Starting"
 *  line at suspend, its "Finished" line at resume; either is at or after the
 *  step's start exactly when the machine slept during it. A journal this user
 *  may not read (not in `wheel`/`adm`/`systemd-journal`) reads null. */
export function readLastSleepAt(): number | null {
    if (process.platform === "linux") {
        const r = spawnSync(
            "journalctl",
            [
                "-b",
                "-q",
                "--no-pager",
                "-o",
                "short-unix",
                "-n",
                "1",
                ...SYSTEMD_SLEEP_UNITS.flatMap((u) => ["-u", u]),
            ],
            { encoding: "utf8", timeout: 5000 }
        );
        if (r.status !== 0) return null;
        return parseJournalLastUnix(r.stdout);
    }
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
    /** The `HEALTH_SCRIPTS` entry (`check:game-download`). */
    step?: string;
    /** The child's exit code; null when a signal killed it. */
    exitCode?: number | null;
    /** The child's stdout + stderr — read for a browser step, and for a
     *  step that failed on a saturated machine. */
    output?: string;
}

/** The `HEALTH_SCRIPTS` entry's script name: the word before any flag. */
function scriptOf(step: string | undefined): string {
    return (step ?? "").split(/\s+/)[0];
}

/** The scripts that drive a browser against the deployment: the per-game
 *  card-data download (issue #5618). It speaks `check:ui`'s exit contract —
 *  0 pass, 1 red, `WALK_FATAL_EXIT` / `DEPLOYMENT_DOWN_EXIT` the run could not
 *  measure — and runs only at `release`, off the heavy mutex, after the
 *  offline gates. `check:ui` itself is no health step (issue #6143). */
const BROWSER_STEP_SCRIPTS: ReadonlySet<string> = new Set([
    "check:game-download",
]);

/** Whether a `HEALTH_SCRIPTS` entry is a browser step (release-only). */
export function isBrowserStep(step: string | undefined): boolean {
    return BROWSER_STEP_SCRIPTS.has(scriptOf(step));
}

/** Why a FAILED step is not the tree's fault, or null when it is. The
 *  deployment-down code counts only on a browser step: another script
 *  exiting 3 says nothing about the backend. */
export function infraCause(input: StepOutcome): InfraCause | null {
    if (input.ok) return null;
    const browser = isBrowserStep(input.step);
    if (browser && input.exitCode === DEPLOYMENT_DOWN_EXIT)
        return "convex-down";
    // A gate that never started: nothing ran.
    if (input.exitCode === INFRA_EXIT) return "gate-not-run";
    if (input.lastSleepAt !== null && input.lastSleepAt >= input.startedAt)
        return "sleep";
    if (
        browser &&
        walkRunVerdict(input.exitCode ?? null, input.output ?? "") === "infra"
    )
        return "browser-step";
    return null;
}

/**
 * The verdict on one gate step. A step that passed is green whatever the
 * machine did — its tests ran to completion. A step that failed is `infra`
 * only when `infraCause` names a cause: the machine entered sleep at or after
 * the step started, a browser step found the deployment down, or its own
 * output says the environment cut it short.
 */
export function stepVerdict(input: StepOutcome): "green" | "red" | "infra" {
    if (input.ok) return "green";
    return infraCause(input) === null ? "red" : "infra";
}

/**
 * The preflight (issue #4943): before any gate runs, ask the deployment a
 * browser step will need — the same probe it makes. `convex-down` when the
 * run includes a browser step (`isBrowserStep`), a URL is configured, and it
 * does not answer; otherwise null and the gates run. No URL is left to the
 * step to report: a missing configuration is not a down backend.
 */
export async function convexPreflight(input: {
    gates: readonly string[];
    url: string | undefined;
    probe: (url: string) => Promise<boolean>;
}): Promise<InfraCause | null> {
    const needsBackend = input.gates.some(isBrowserStep);
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
 *  (`queue:plan`; a shell driver composes the same line): the tip is
 *  unproven, not red, and here is what to do. */
export function infraNotice(r: InfraRecord): string {
    const sha = r.sha ? r.sha.slice(0, 8) : "unknown sha";
    return `release health is INFRA @ ${sha} (at ${r.failedStep ?? "unknown step"}) — the tip is unproven, not red: ${r.reason ?? "re-run `bun run health`"}`;
}

/** The browser steps' state as `health:status` prints it, separately from
 *  the offline verdict (issue #4962; the walk retired, issue #6143). */
export type BrowserStepsState =
    | "green"
    | "red"
    | "infra"
    /** A process is running them now on this tip. */
    | "running"
    /** Batch health owes none: they are `release`'s (issue #5378). */
    | "skipped"
    | "not run";
