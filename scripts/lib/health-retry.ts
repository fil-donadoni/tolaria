/**
 * Health re-runs a failed vitest project once before writing RED (issue
 * #5461). 12 of 105 red trees in 14 days went green on the same head at the
 * next attempt (11%); at 10 issues/h a false RED blocks the queue on both
 * machines for a repair cycle.
 *
 * Only the `test` step is retried: it is vitest end to end
 * (`test:app` → `test:bot` → `test:blade`, chained with `&&`), so a failed
 * project is the whole failure. `check:all` mixes tsc, lint and vitest
 * guards — a green retry of its vitest half would hide a red tsc half, so it
 * is never retried. The retry runs exactly the projects the output names
 * (`FAIL |node-engine| …`), never the step; a failure no project tag
 * explains (the blade config has none, a crash prints no FAIL line) is not
 * retried and stays RED. Because the chain stops at the first red, a green
 * retry then owes the chain scripts that never started.
 *
 * The note names WHAT failed the first time (issue #5484): `timeout` when
 * every failed test timed out (`timeoutOnlyFailure`), `assertion` otherwise.
 * A timeout that passes on the retry is a near-miss on the test's budget —
 * recorded as one, never dropped as an ordinary flake; the run's `headroom:`
 * line (`lib/test-headroom.ts`) names how close it ran.
 *
 * The queue's lane re-runs a failed vitest command once too (issue #5640,
 * `planLaneRetry`): same refusals (an untagged FAIL line, an unhandled error,
 * a signal are never absorbed), but the re-run is narrowed to the failing
 * FILES — a lane's command already names a scoped set, and the whole project
 * would cost minutes for one flaky file.
 *
 * Node builtins plus `lib/health-step.ts`, `lib/health-evidence.ts` and
 * `lib/machine-admission.ts` —
 * `health-main.ts` carries the same constraint.
 */
import {
    ANY_FAIL_LINE,
    CRASH_LINE,
    failLines,
    failingFiles,
    stripAnsi,
} from "./health-evidence";
import type { HealthStep, StepResult } from "./health-step";
import { timeoutOnlyFailure } from "./machine-admission";

/** The step the retry applies to. */
export const RETRY_STEP = "test";

/** `bun run test`'s chain, in order, each with the text its start prints
 *  (`$ bun scripts/gate.ts heavy '…'`) so a log says how far the chain got. */
const TEST_CHAIN: readonly { script: string; marker: string }[] = [
    { script: "test:app", marker: "--project node-engine" },
    { script: "test:bot", marker: "--project bot-node" },
    { script: "test:blade", marker: "BLADE_TIER=must" },
];

/** The echo line `bun run` prints when a chain script starts — anchored, so
 *  a test printing the same text in its own output cannot fake progress. */
function startLine(marker: string): RegExp {
    const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\$ bun scripts/gate\\.ts \\w+ '.*${esc}`, "m");
}

const plainOf = stripAnsi;

/** The vitest projects with a failing test in `output`, sorted, unique — or
 *  null when some failure carries no project tag (so no retry can cover it).
 *  Both label forms count (`lib/health-evidence.ts`, issue #5589): a
 *  coloured run prints ` proj ` where a plain one prints `|proj|`, and
 *  reading only the second left a coloured RED unretried. */
export function failedVitestProjects(output: string): string[] | null {
    const plain = plainOf(output);
    const lines = failLines(plain);
    const projects = new Set<string>();
    for (const l of lines) if (l.project) projects.add(l.project);
    const tagged = lines.filter((l) => l.project).length;
    const any = [...plain.matchAll(ANY_FAIL_LINE)].length;
    if (projects.size === 0 || tagged !== any) return null;
    return [...projects].sort();
}

export interface RetryPlan {
    projects: string[];
    /** Chain scripts after the failed one that never started. */
    remaining: string[];
}

/** What a failed `test` step owes before it may be called RED, or null when
 *  it is RED at once. */
export function planRetry(stepName: string, output: string): RetryPlan | null {
    if (stepName !== RETRY_STEP) return null;
    const projects = failedVitestProjects(output);
    if (projects === null) return null;
    const plain = plainOf(output);
    // A failure the FAIL lines do not explain is not a flake to absorb.
    if (/Unhandled (Errors|Rejection)/i.test(plain)) return null;
    const started = TEST_CHAIN.filter((c) => startLine(c.marker).test(plain));
    const last = started.length > 0 ? started[started.length - 1] : undefined;
    const from = last ? TEST_CHAIN.indexOf(last) + 1 : 1;
    return {
        projects,
        remaining: TEST_CHAIN.slice(from).map((c) => c.script),
    };
}

/** What the first, retried failure was: every failed test timed out, or
 *  something else did (an assertion, a hook error). */
export type RetryCause = "timeout" | "assertion";

/** The cause of a failed `test` step's output. */
export function retryCauseOf(output: string): RetryCause {
    return timeoutOnlyFailure(plainOf(output)) ? "timeout" : "assertion";
}

/** `test (retry: bot-node, timeout)` — the step field a retried verdict
 *  carries. */
export function retryNote(
    stepName: string,
    projects: readonly string[],
    cause?: RetryCause
): string {
    // A record written before issue #5484 carries no cause.
    return `${stepName} (retry: ${projects.join(",")}${cause ? `, ${cause}` : ""})`;
}

export interface RetriedStep {
    result: StepResult;
    /** Set when the step failed once and was re-run: the projects retried. */
    retried?: string[];
    /** Set with `retried`: what the first failure was. */
    cause?: RetryCause;
}

/** The retry's own step: exactly the failed projects, under the heavy gate. */
function retryStep(step: HealthStep, projects: readonly string[]): HealthStep {
    return {
        ...step,
        name: `${step.name} retry`,
        cmd: "bun",
        args: [
            "scripts/gate.ts",
            "heavy",
            `vitest run ${projects.map((p) => `--project ${p}`).join(" ")}`,
        ],
    };
}

/**
 * Runs `step` through `run`; on a failure `planRetry` covers, re-runs exactly
 * the failed projects (then the chain scripts that never started). GREEN only
 * when all pass; the second failure is returned as the result, so RED names
 * what failed twice.
 */
export async function runStepWithRetry(
    step: HealthStep,
    run: (s: HealthStep) => Promise<StepResult>,
    log: (line: string) => void = () => {}
): Promise<RetriedStep> {
    const first = await run(step);
    if (first.ok) return { result: first };
    // A crash or OOM kill is not a flaky test (the exit has a signal).
    const plan = first.signal ? null : planRetry(step.name, first.output);
    if (plan === null) return { result: first };

    log(
        `health-main: ${step.name} failed (${retryCauseOf(first.output)}) in ${plan.projects.join(", ")} — re-running only that, once (issue #5461)\n`
    );
    let result = await run(retryStep(step, plan.projects));
    for (const script of plan.remaining) {
        if (!result.ok) break;
        result = await run({
            ...step,
            name: script,
            args: ["run", script],
        });
    }
    return {
        result,
        retried: plan.projects,
        cause: retryCauseOf(first.output),
    };
}

// ── the queue lane's retry (issue #5640) ────────────────────────────────────

/** The lane commands the retry covers: a vitest run, nothing else. `tsc`,
 *  eslint and the guards are deterministic — a green second run of one would
 *  hide a real red. */
const LANE_VITEST = /^bunx vitest run(\s|$)/;

export interface LaneRetryPlan {
    projects: string[];
    files: string[];
    /** The narrowed command: the failed projects, the failing files only. */
    command: string;
    cause: RetryCause;
}

function shellWord(path: string): string {
    return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** What a failed lane `command` owes before it may be called red, or null
 *  when it is red at once (not a vitest run, an untagged or unexplained
 *  failure, an unhandled error). */
export function planLaneRetry(
    command: string,
    output: string
): LaneRetryPlan | null {
    if (!LANE_VITEST.test(command)) return null;
    const projects = failedVitestProjects(output);
    if (projects === null) return null;
    if (/Unhandled (Errors|Rejection)/i.test(plainOf(output))) return null;
    // A narrowed re-run would green files that never ran: a crashed run (OOM,
    // worker exit) or one with no summary is not a flake (review of #5640).
    if (CRASH_LINE.test(plainOf(output))) return null;
    if (!/^\s*Test Files\s/m.test(plainOf(output))) return null;
    const files = failingFiles(output);
    if (files.length === 0) return null;
    return {
        projects,
        files,
        command: `bunx vitest run ${projects.map((p) => `--project ${p}`).join(" ")} ${files.map(shellWord).join(" ")}`,
        cause: retryCauseOf(output),
    };
}

/** What the lane's JSON records for a flake: it failed once, passed on the
 *  re-run. Numbers and test file names only — a public log carries it. */
export interface LaneFlake {
    projects: string[];
    files: string[];
    cause: RetryCause;
}

export function laneFlakeOf(plan: LaneRetryPlan): LaneFlake {
    return { projects: plan.projects, files: plan.files, cause: plan.cause };
}
