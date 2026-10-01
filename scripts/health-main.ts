#!/usr/bin/env bun
/**
 * The full health gate for a branch tip (ADR 0110, re-homed by ADR 0116).
 *
 * `land` runs the LANE gate only; `bun run release` runs this script on the
 * base branch tip before fast-forwarding the release branch,
 * `scripts/health-cadence.ts` detaches it once per BATCH of landings (ADR
 * 0136 §6), and `bun run health` runs it by hand. It runs the FULL gate
 * (`HEALTH_SCRIPTS` in `lib/health-step.ts`: `check:all`, the derived Op census
 * `check:gaps`, the Coverage Invariant `check:targets`, the test-suite
 * hygiene census `check:test-hygiene`, all three test suites, and the full
 * `check:ui --all` browser walk, issue #4913) against the
 * merged tip, in a throwaway worktree, and leaves a durable verdict in
 * `.claude/telemetry/health/`:
 *
 *   - `last.json`  — { sha, status: running|green|red|infra, startedAt, finishedAt, log }
 *   - `RED`        — marker file, present iff the last completed run was red.
 *                    `land` warns when it exists; `bun run health:status`
 *                    prints the details. Fix-forward, then the next green run
 *                    removes it.
 *
 * A step that failed while the machine was asleep (`lib/health-verdict.ts`,
 * issue #4938) is `infra`: recorded, exit 1, but no `RED` marker written and
 * none cleared — the tip is unproven, not red, and the next run re-gates it.
 * So is a `check:ui` step that found the Convex deployment down (its own exit
 * code, issue #4943) — and a run whose PREFLIGHT finds it down records
 * `infra` at step `preflight:convex` before any gate runs, in seconds rather
 * than after ~40 minutes of gates. Health never STARTS the backend: the AFK
 * loop's `convex:ensure` does (issue #4945).
 *
 * Deduplicated by sha: a tip that is already green, or already being gated
 * (a `running` record younger than 90 minutes), is not re-gated — so N
 * quick successive lands cost ONE health run on the final tip.
 *
 * The gate runs in its own worktree at the tip, never in the primary
 * checkout's working tree (which may hold anything), and with
 * TOLARIA_GATE_HELD scrubbed so it queues on the machine mutex like any
 * other heavy gate instead of inheriting `land`'s already-released hold.
 *
 * `--branch=<name>` picks the tip to gate (default: the base branch from
 * tolaria.config.json). `--status` prints the last verdict plus a
 * stale-worktree report (worktrees whose branch is merged into the base —
 * the corpses policy of ADR 0110). `--under-lock` says the CALLER already
 * holds the heavy mutex for the whole run and the steps must pass through it
 * rather than each queue for it — what `health-cadence.ts` passes under its
 * single `gate.ts yield` acquisition (ADR 0136 §6); `release` never does.
 *
 * Each step reports to the terminal while it runs (issue #3487) — start and
 * end lines, the gate's `[gate]` mutex-wait lines live, a liveness line while
 * a step is long — and the per-sha log still receives the full child output.
 * `lib/health-step.ts` owns that.
 *
 * A batch whose diff touched the Bot's globs (`lib/bot-globs.ts`) also
 * re-measures the Bot Findings page (`lib/health-bot-refresh.ts`, ADR 0141 § 5,
 * issue #4181) AFTER the gates pass: `bot:reach`, then `seed:bot-findings`.
 * Such a batch also owes `BOT_HEALTH_SCRIPTS` (the blade robustness audit,
 * issue #4875), run after the other gates and before the refresh, and red
 * like any gate.
 * The two refresh steps NEVER fail the batch — a stale page is marked stale, not a
 * red tip — and neither `land` nor `check:pr` runs them.
 *
 * Zero imports beyond node builtins, `lib/branches.ts`, `lib/health-step.ts`,
 * `lib/health-verdict.ts`, `lib/convex-reachable.ts` and
 * `lib/health-bot-refresh.ts` (builtins and the import-free
 * `lib/bot-globs.ts` only) — same constraint as bootstrap-worktree.
 */
import { spawnSync } from "node:child_process";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import {
    batchTouchesBot,
    botRefreshSteps,
    REFRESHED_ARTIFACT_NAME,
} from "./lib/health-bot-refresh";
import {
    healthGateEnv,
    healthStepArgs,
    runHealthStep,
    healthGates,
    HEALTH_SCRIPTS,
    type HealthStep,
} from "./lib/health-step";
import {
    convexPreflight,
    INFRA_REMEDY,
    infraCause,
    PREFLIGHT_CONVEX_STEP,
    readLastSleepAt,
    recordInfra,
    type HealthStatus,
    type InfraCause,
} from "./lib/health-verdict";
import { reachable, readEnvLocal } from "./lib/convex-reachable";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const HEALTH_DIR = ".claude/telemetry/health";
const STALE_RUNNING_MS = 90 * 60 * 1000;

interface LastRun {
    sha: string;
    status: HealthStatus;
    startedAt: string;
    finishedAt?: string;
    failedStep?: string;
    log?: string;
    /** `infra` only: why, and what to do (`INFRA_REMEDY`). */
    infraCause?: InfraCause;
    reason?: string;
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/** Primary checkout dir, or null when cwd already is it (same test as
 *  bootstrap-worktree.ts: `--git-common-dir` is relative in the primary). */
function primaryCheckout(cwd: string): string | null {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    if (!common.startsWith("/")) return null;
    return dirname(resolve(common));
}

function readLast(dir: string): LastRun | null {
    try {
        return JSON.parse(
            readFileSync(join(dir, "last.json"), "utf8")
        ) as LastRun;
    } catch {
        return null;
    }
}

function writeLast(dir: string, run: LastRun): void {
    writeFileSync(join(dir, "last.json"), JSON.stringify(run, null, 2));
}

/** Repo-relative paths that changed between the last GREEN tip and `tip` —
 *  the batch's diff. `null` when it cannot be taken: no green tip recorded, or
 *  it is no longer an ancestor-reachable object here. */
function batchChangedFiles(root: string, tip: string): string[] | null {
    let green: string;
    try {
        green = readFileSync(
            join(root, ".claude/telemetry/green-sha"),
            "utf8"
        ).trim();
    } catch {
        return null;
    }
    if (green === "") return null;
    const r = spawnSync("git", ["diff", "--name-only", `${green}..${tip}`], {
        encoding: "utf8",
        cwd: root,
    });
    if (r.status !== 0) return null;
    return r.stdout.split("\n").filter((line) => line !== "");
}

/** Worktrees whose checked-out branch is already merged into origin/main —
 *  the corpses `land`'s teardown missed (killed passes, abandoned batches). */
function staleWorktrees(cwd: string): string[] {
    const out = git(["worktree", "list", "--porcelain"], cwd);
    const stale: string[] = [];
    let path = "";
    for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice(9);
        if (line.startsWith("branch refs/heads/")) {
            const branch = line.slice(18);
            if (branch === BASE_BRANCH || branch === RELEASE_BRANCH) continue;
            // A freshly-created branch still AT the main tip is trivially an
            // ancestor — that is "not yet worked", not a corpse.
            let atTip = false;
            try {
                atTip =
                    git(["rev-parse", branch], cwd) ===
                    git(["rev-parse", ORIGIN_BASE], cwd);
            } catch {
                // unreadable ref — fall through to the ancestor check
            }
            if (atTip) continue;
            const merged =
                spawnSync(
                    "git",
                    ["merge-base", "--is-ancestor", branch, ORIGIN_BASE],
                    { cwd }
                ).status === 0;
            if (merged) stale.push(`${path} [${branch}]`);
        }
    }
    return stale;
}

function status(root: string): never {
    const dir = join(root, HEALTH_DIR);
    const last = readLast(dir);
    const red = existsSync(join(dir, "RED"));
    console.log("health:status —", root);
    if (!last) console.log("  no health run recorded yet");
    else
        console.log(
            `  last: ${last.status.toUpperCase()} @ ${last.sha.slice(0, 8)} (started ${last.startedAt}${last.finishedAt ? `, finished ${last.finishedAt}` : ""})${last.failedStep ? ` — failed at ${last.failedStep}` : ""}${last.reason ? `\n  why:  ${last.reason}` : ""}${last.log ? `\n  log:  ${last.log}` : ""}`
        );
    const stale = staleWorktrees(root);
    if (stale.length > 0) {
        console.log(
            `  stale worktrees (branch merged — remove with 'bun run wt:gc'):`
        );
        for (const s of stale) console.log(`    · ${s}`);
    }
    process.exit(red ? 1 : 0);
}

async function main(): Promise<void> {
    const cwd = process.cwd();
    const primary = primaryCheckout(cwd);
    const root = primary ?? cwd;

    if (process.argv.includes("--status")) status(root);

    if (primary !== null) {
        console.error(
            "health-main: run from the primary checkout (release runs it there)"
        );
        process.exit(2);
    }

    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });

    const underLock = process.argv.includes("--under-lock");
    const branchArg = process.argv.find((a) => a.startsWith("--branch="));
    const branch = branchArg
        ? branchArg.slice("--branch=".length)
        : BASE_BRANCH;
    git(["fetch", "origin", branch, "-q"], root);
    const tip = git(["rev-parse", `origin/${branch}`], root);

    const last = readLast(dir);
    if (last?.sha === tip) {
        if (last.status === "green") {
            console.log(`health-main: tip ${tip.slice(0, 8)} already green`);
            return;
        }
        if (
            last.status === "running" &&
            Date.now() - Date.parse(last.startedAt) < STALE_RUNNING_MS
        ) {
            console.log(
                `health-main: tip ${tip.slice(0, 8)} already being gated`
            );
            return;
        }
    }

    const startedAt = new Date().toISOString();
    const finishInfra = (
        cause: InfraCause,
        failedStep: string,
        log: string | undefined
    ): never => {
        recordInfra<LastRun>({
            dir,
            infra: {
                sha: tip,
                status: "infra",
                startedAt,
                finishedAt: new Date().toISOString(),
                failedStep,
                infraCause: cause,
                reason: INFRA_REMEDY[cause],
                ...(log ? { log } : {}),
            },
            // Read before this run's `running` record overwrote it.
            previous: last,
            redMarkerStanding: existsSync(join(dir, "RED")),
        });
        console.error(
            `health-main: INFRA @ ${tip.slice(0, 8)} at ${failedStep} — ${INFRA_REMEDY[cause]}${log ? ` — ${log}` : ""}`
        );
        process.exit(1);
    };

    writeLast(dir, { sha: tip, status: "running", startedAt });

    const wt = join(root, "..", `tolaria-health-${process.pid}`);
    const logPath = join(dir, `${tip.slice(0, 12)}.log`);
    // Queues on the machine mutex, and bypasses the guard cache (issue #3646)
    // — unless the caller already took the mutex FOR the whole run, which is
    // what the per-batch gate does (`--under-lock`, ADR 0136 §6): there the
    // three steps pass through that one hold instead of queuing three times,
    // so the block a queued `land` waits for is one block, not three.
    const env = healthGateEnv(process.env, { keepHold: underLock });

    const refreshBot = batchTouchesBot(batchChangedFiles(root, tip));
    // A Bot batch also owes the Bot-only gates (issue #4875), after the rest.
    const scripts = HEALTH_SCRIPTS;
    const gates = healthGates(scripts, refreshBot);
    // The deployment `check:ui` needs, asked BEFORE ~40 minutes of gates
    // (issue #4943) — the same probe `check:ui` makes, on the URL it reads.
    const preflight = await convexPreflight({
        gates,
        url: process.env.VITE_CONVEX_URL ?? readEnvLocal(root).VITE_CONVEX_URL,
        probe: (url) => reachable(url, 5000),
    });
    if (preflight !== null)
        finishInfra(preflight, PREFLIGHT_CONVEX_STEP, undefined);

    const steps: HealthStep[] = gates.map((name, i) => ({
        ordinal: i + 1,
        total: gates.length,
        name,
        cmd: "bun",
        args: healthStepArgs(name),
    }));

    const refreshSteps = refreshBot ? botRefreshSteps(steps.length) : [];
    if (refreshBot) {
        // The gates' own "[n/total]" lines must already count the refresh.
        for (const step of steps)
            step.total = steps.length + refreshSteps.length;
    }

    let failedStep: string | undefined;
    let failedCause: InfraCause | null = null;
    try {
        git(["worktree", "add", "--detach", wt, tip], root);
        for (const step of steps) {
            const stepStartedAt = Date.now();
            const r = await runHealthStep(step, { cwd: wt, env, logPath });
            if (!r.ok) {
                failedStep = step.name;
                // Read at once: a later sleep must not reach back to this step.
                failedCause = infraCause({
                    ok: false,
                    startedAt: stepStartedAt,
                    lastSleepAt: readLastSleepAt(),
                    step: step.name,
                    exitCode: r.status,
                });
                break;
            }
        }
        // Only a batch that passed re-measures, and a refresh that fails or
        // is cut short leaves the page stale (marked so) instead of the tip
        // red: the measurement is a view of the Bot, not a gate on it.
        if (failedStep === undefined) {
            try {
                let refreshed = refreshSteps.length > 0;
                for (const step of refreshSteps) {
                    const r = await runHealthStep(step, {
                        cwd: wt,
                        env,
                        logPath,
                    });
                    if (!r.ok) {
                        refreshed = false;
                        console.error(
                            `health-main: ${step.name} failed — Bot Findings stay stale (${logPath})`
                        );
                        break;
                    }
                }
                // Kept beside `last.json`: the worktree is removed below, and
                // the artifact is what a PR commits (`bun run bot:reach`).
                const artifact = join(wt, "data/bot-reach-findings.json");
                if (refreshed && existsSync(artifact))
                    copyFileSync(artifact, join(dir, REFRESHED_ARTIFACT_NAME));
            } catch (err) {
                // A throw here (spawn error, full disk) must not skip the
                // verdict record below: the gates passed, the tip is green.
                console.error(
                    `health-main: Bot Findings refresh threw — page stays stale: ${String(err)}`
                );
            }
        }
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }

    if (failedStep && failedCause !== null)
        finishInfra(failedCause, failedStep, logPath);

    if (failedStep) {
        writeLast(dir, {
            sha: tip,
            status: "red",
            startedAt,
            finishedAt: new Date().toISOString(),
            failedStep,
            log: logPath,
        });
        writeFileSync(
            join(dir, "RED"),
            `${branch} @ ${tip} red at ${failedStep} — log: ${logPath}\n`
        );
        console.error(
            `health-main: RED @ ${tip.slice(0, 8)} (${failedStep}) — ${logPath}`
        );
        process.exit(1);
    }

    writeLast(dir, {
        sha: tip,
        status: "green",
        startedAt,
        finishedAt: new Date().toISOString(),
        log: logPath,
    });
    rmSync(join(dir, "RED"), { force: true });
    // The health gate IS the authoritative green record now (ADR 0110).
    writeFileSync(join(root, ".claude/telemetry/green-sha"), `${tip}\n`);
    console.log(`health-main: GREEN @ ${tip.slice(0, 8)}`);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
