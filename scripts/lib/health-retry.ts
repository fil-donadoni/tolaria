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
 * Node builtins plus `lib/health-step.ts` — `health-main.ts` carries the
 * same constraint.
 */
import type { HealthStep, StepResult } from "./health-step";

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

const TAGGED_FAIL =
    /^\s*(?:[❯>×✗]\s*)?FAIL\s+\|([^|\n]+)\|\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?\b/gm;
const ANY_FAIL = /^\s*(?:[❯>×✗]\s*)?FAIL\s+\S/gm;

function plainOf(output: string): string {
    // eslint-disable-next-line no-control-regex -- stripping the ANSI colour codes
    return output.replace(/\u001b\[[0-9;]*m/g, "");
}

/** The vitest projects with a failing test in `output`, sorted, unique — or
 *  null when some failure carries no project tag (so no retry can cover it). */
export function failedVitestProjects(output: string): string[] | null {
    const plain = plainOf(output);
    const projects = new Set<string>();
    for (const m of plain.matchAll(TAGGED_FAIL)) projects.add(m[1].trim());
    const tagged = [...plain.matchAll(TAGGED_FAIL)].length;
    const any = [...plain.matchAll(ANY_FAIL)].length;
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

/** `test (retry: node-engine)` — the step field a retried verdict carries. */
export function retryNote(
    stepName: string,
    projects: readonly string[]
): string {
    return `${stepName} (retry: ${projects.join(",")})`;
}

export interface RetriedStep {
    result: StepResult;
    /** Set when the step failed once and was re-run: the projects retried. */
    retried?: string[];
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
        `health-main: ${step.name} failed in ${plan.projects.join(", ")} — re-running only that, once (issue #5461)\n`
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
    return { result, retried: plan.projects };
}
