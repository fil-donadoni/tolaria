/**
 * Health inside a GitHub Actions job (ADR 0156, issue #5645): which runs a
 * job may start, and which of their verdicts reach the shared store.
 *
 * Two job runs exist beside the by-hand / `release` / cadence runs:
 *
 *  - **scheduled** (`--scheduled`, `health.yml` on a `lane` runner): the full
 *    offline gate, from the job's worktree of the machine's primary
 *    checkout. Every verdict is written. Unattended, it never re-gates a tip
 *    the store already holds a RED for — the RED ladder (`health-bisect.ts`)
 *    owns that tip, and a repair moves it.
 *  - **early** (`--early`, `health-early.yml` on a GitHub-hosted runner after
 *    each batch of merges): the same offline gate, minus the committed-corpus
 *    tests (no reader key on a hosted runner, issue #5675). A run that skipped
 *    tests proves no GREEN, so only its RED reaches the store — the RED that
 *    holds the queue sooner, so fewer PRs separate the last GREEN from it.
 *    Its GREEN and its INFRA stay in the runner's own record.
 *
 * Node builtins only: `health-main.ts` imports this before `node_modules`
 * may exist.
 */
import { resolve } from "node:path";
import type { HealthStatus } from "./health-verdict";

export type HealthRunMode = "default" | "scheduled" | "early";

/** The mode `argv` asks for. `--early` wins over `--scheduled`. */
export function healthRunMode(argv: readonly string[]): HealthRunMode {
    if (argv.includes("--early")) return "early";
    if (argv.includes("--scheduled")) return "scheduled";
    return "default";
}

/**
 * Why an early run may not start, or null. Early runs only on a
 * GitHub-hosted runner, and only with the corpus exclusion set (`excluded`,
 * `corpusExcluded()`): without it the corpus tests run with no reader key
 * and fail, and an early run would write a RED the tree never earned.
 */
export function earlyRunRefusal(
    env: NodeJS.ProcessEnv,
    excluded: boolean
): string | null {
    if (
        env.GITHUB_ACTIONS !== "true" ||
        env.RUNNER_ENVIRONMENT !== "github-hosted"
    )
        return "--early runs on a GitHub-hosted runner only (health-early.yml)";
    if (!excluded)
        return "--early needs TOLARIA_HOSTED_NO_VERDICT_CORPUS=1: a hosted runner holds no corpus reader key";
    return null;
}

/** Whether a verdict of `status` reaches the shared store in `mode`. */
export function storesVerdict(
    mode: HealthRunMode,
    status: HealthStatus | "amber"
): boolean {
    return mode !== "early" || status === "red";
}

/**
 * Whether `cwd` is the job worktree of a self-hosted job — the workspace the
 * job cut from the primary checkout (`scripts/ci/job-worktree.sh`). Health
 * refuses every other linked worktree: a session's tree is not where a gate
 * runs (the issue-worktree rule), but a job's worktree IS the job.
 */
export function inJobWorktree(cwd: string, env: NodeJS.ProcessEnv): boolean {
    const ws = env.GITHUB_WORKSPACE;
    return (
        env.GITHUB_ACTIONS === "true" &&
        typeof ws === "string" &&
        ws !== "" &&
        resolve(cwd) === resolve(ws)
    );
}

/**
 * The skip an UNATTENDED job run (`scheduled`, `early`) adds to
 * `gateSkipReason`: a tip the store already holds a RED for is not re-gated
 * — its ladder confirms it, its repair moves the tip. Null: gate it.
 */
export function unattendedSkip(
    mode: HealthRunMode,
    tip: string,
    stored: { sha: string; status: string } | null
): string | null {
    if (mode === "default" || stored === null || stored.sha !== tip)
        return null;
    return stored.status === "red"
        ? `tip ${tip.slice(0, 8)} already RED on the verdict store — the RED ladder owns it (bun run health:bisect ladder)`
        : null;
}
