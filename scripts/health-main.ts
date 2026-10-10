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
 * hygiene census `check:test-hygiene`, all three test suites, and — under
 * `--ui-all`, which `release` passes, and only then — the full `check:ui`
 * browser walk: a batch run owes none (`lib/health-walk-plan.ts`, issue
 * #5378)) against the merged tip, in a throwaway worktree, and leaves a durable verdict in
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
 * loop's `convex:ensure` does (issue #4945). So is a walk the environment cut
 * short (a fatal `check:ui` exit, or every failing row `INFRA`): `last.json`
 * names the two halves, `offline` and `ui`. A walk the tree failed is RED
 * (its probation, issue #4962, retired by issue #5378).
 *
 * TWO PHASES (issue #4962). The offline gates and the browser walk are cut by
 * `splitHealthGates`. `--phase=offline` runs the first and, when green, leaves
 * a `running` record with `phase: "walk"` and exits; `--phase=walk` picks it
 * up and writes the run's ONE verdict. `health-cadence detach` runs the first
 * under its `gate.ts yield` hold and the second after releasing it, so no
 * `land` queues behind a browser walk. With no `--phase` (`release`, by hand)
 * one process runs both, and the walk is still off the mutex: only
 * `--under-lock` ever passes a hold through, and the walk scrubs it.
 *
 * Deduplicated by sha: a tip that is already green, or already being gated
 * (a `running` record younger than 90 minutes), is not re-gated — so N
 * quick successive lands cost ONE health run on the final tip. Under
 * `--under-lock` (the cadence's waiter) a RED or INFRA tip is not re-gated
 * either; by hand it is (`gateSkipReason`, issue #4960).
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
 * holds the heavy mutex for the OFFLINE gates and they must pass through it
 * rather than each queue for it — what `health-cadence.ts` passes under its
 * single `gate.ts yield` acquisition (ADR 0136 §6); `release` never does. It
 * implies `--phase=offline`: a hold is never carried into the walk.
 *
 * Each step reports to the terminal while it runs (issue #3487) — start and
 * end lines, the gate's `[gate]` mutex-wait lines live, a liveness line while
 * a step is long — and the per-sha log still receives the full child output.
 * `lib/health-step.ts` owns that.
 *
 * A batch whose diff touched the Bot's globs (`lib/bot-globs.ts`) also
 * re-measures the Bot Findings page (`lib/health-bot-refresh.ts`, ADR 0141 § 5,
 * issue #4181) AFTER the gates pass: `bot:reach`, then `seed:bot-findings`.
 * The blade robustness audit (issue #4875) is NOT a gate of this run (issue
 * #5079): a batch that owes it (`lib/health-robustness-trigger.ts`, issue
 * #5078) leaves a request beside `last.json` (`lib/health-robustness-audit.ts`)
 * and `health-cadence` runs it after the verdict, off the critical path. Its
 * only `wrong` — an entry failing its own seeds — is what `test:blade` already
 * reds in this run. Declared residual: only `health-cadence` starts it, so a
 * `release` or by-hand run leaves its request unclaimed (per-tip file, never
 * overwritten) and that batch's audit waits for a later cadence fire to be
 * re-requested by a triggering batch.
 * The two refresh steps NEVER fail the batch — a stale page is marked stale, not a
 * red tip — and neither `land` nor `check:pr` runs them.
 *
 * The MACHINE is asked before the gates start (issue #4966,
 * `lib/machine-admission.ts`): over a `machine.*` threshold the run waits,
 * bounded, then ends `infra` at `preflight:machine` — and a suite step whose
 * every failed test timed out while its own samples read saturated is `infra`
 * too (`machine-timeout`), ONCE: the same step timing out on the next run is
 * RED.
 *
 * Zero imports beyond node builtins, `lib/branches.ts`, `lib/health-step.ts`,
 * `lib/health-verdict.ts`, `lib/convex-reachable.ts`,
 * `lib/machine-admission.ts` (builtins and `lib/branches.ts`),
 * `lib/health-robustness-audit.ts` (builtins, `lib/health-robustness-drift.ts`
 * and `lib/health-robustness-trigger.ts`, so `lib/gh.ts` too),
 * `lib/health-robustness-trigger.ts` (builtins, `lib/bot-globs.ts`,
 * `lib/import-graph.ts`, `lib/blade-registry-entries.ts`) and
 * `lib/health-bot-refresh.ts` (builtins and the import-free
 * `lib/bot-globs.ts` only), and through `lib/health-verdict.ts` the
 * `ui-gate/infra-verdict.ts` (builtins and `lib/convex-reachable.ts`) — same constraint as
 * bootstrap-worktree.
 */
import { spawnSync } from "node:child_process";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import {
    batchTouchesBot,
    botRefreshSteps,
    FILING_STEP_NAME,
    REFRESHED_ARTIFACT_NAME,
} from "./lib/health-bot-refresh";
import {
    describePickRecord,
    readPickRecord,
    writePickRequest,
} from "./lib/health-pick-agreement-audit";
import {
    describeAuditRecord,
    readAuditRecord,
    writeAuditRequest,
} from "./lib/health-robustness-audit";
import {
    describeRobustnessMode,
    robustnessModeFromGit,
    robustnessOwed,
} from "./lib/health-robustness-trigger";
import {
    healthGateEnv,
    healthStepArgs,
    runHealthStep,
    splitHealthGates,
    HEALTH_SCRIPTS,
    WALK_BOOTSTRAP,
    type HealthStep,
} from "./lib/health-step";
import {
    convexPreflight,
    INFRA_REMEDY,
    infraCause,
    PREFLIGHT_CONVEX_STEP,
    PREFLIGHT_MACHINE_STEP,
    readLastSleepAt,
    recordInfra,
    repeatedMachineTimeout,
    type HealthStatus,
    type InfraCause,
    type UiWalkState,
} from "./lib/health-verdict";
import { reachable, readEnvLocal } from "./lib/convex-reachable";
import { waitForWalkWindow } from "./lib/health-walk-wait";
import {
    describeWalkPlan,
    FORCED_REASON,
    planHealthWalk,
    walkWasFull,
    type WalkPlan,
} from "./lib/health-walk-plan";
import {
    gateLockRoot,
    heavyHolderLine,
    heavyHolderLive,
    runningHolderLine,
} from "./lib/ui-admission";
import {
    readMachineConfig,
    readMachineSample,
    runSaturated,
    waitForMachine,
} from "./lib/machine-admission";
import {
    describeLastDecision,
    gateSkipReason,
    parseCadence,
} from "./lib/health-cadence";
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
    /** The two halves of the verdict, each named on its own (issue #4962):
     *  the offline gates, and the browser walk. */
    offline?: "green" | "red" | "infra";
    ui?: UiWalkState;
    /** Which walk this run owed (issues #5076, #5378): `describeWalkPlan`'s
     *  text, for `health:status`. */
    walk?: string;
    /** Which blade robustness audit this run owed (issue #5078):
     *  `describeRobustnessMode`'s text — mode and the first triggering path —
     *  for `health:status`. */
    robustness?: string;
    /** `running`, `phase: "walk"` only: the plan the walk phase executes. */
    walkPlan?: WalkPlan;
    /** `running` only: `walk` once the offline gates passed and the walk is
     *  owed, off the heavy mutex (`--phase=walk`). */
    phase?: "walk";
    phaseStartedAt?: string;
    /** The branch the tip was read from — the walk phase's RED marker names it. */
    branch?: string;
    /** `running` only: the record this run replaced, carried across the two
     *  phases so a walk-phase `infra` can keep a standing red one
     *  (`infraRecordToKeep`). */
    prior?: LastRun;
}

/** The record a run replaces, as it carries it: one level, never a chain. */
function priorOf(last: LastRun | null): LastRun | undefined {
    if (last === null) return undefined;
    const rest = { ...last };
    delete rest.prior;
    return rest;
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

/** The last GREEN tip, or `null` when none is recorded or readable. */
function readGreenSha(root: string): string | null {
    try {
        const green = readFileSync(
            join(root, ".claude/telemetry/green-sha"),
            "utf8"
        ).trim();
        return green === "" ? null : green;
    } catch {
        return null;
    }
}

/** Repo-relative paths that changed between the last GREEN tip and `tip` —
 *  the batch's diff. `null` when it cannot be taken: no green tip recorded, or
 *  it is no longer an ancestor-reachable object here. */
function batchChangedFiles(root: string, tip: string): string[] | null {
    const green = readGreenSha(root);
    if (green === null) return null;
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
    // Why the last landing did or did not fire the batch gate (issue #4964).
    const cadence = join(dir, "cadence.json");
    console.log(
        `  cadence: ${describeLastDecision(parseCadence(existsSync(cadence) ? readFileSync(cadence, "utf8") : null))}`
    );
    // The two halves, each on its own (issue #4962): a walk the environment
    // cut short says so instead of hiding inside the run's single status.
    if (last)
        console.log(
            `  offline: ${last.offline ?? "unrecorded"} · ui: ${last.ui ?? "unrecorded"}${last.walk ? `\n  walk: ${last.walk}` : ""}${last.robustness ? `\n  blade: ${last.robustness}` : ""}`
        );
    const audit = readAuditRecord(dir);
    if (audit)
        console.log(
            `  blade audit: ${describeAuditRecord(audit, pidAlive(audit.pid))}`
        );
    const pick = readPickRecord(dir);
    if (pick)
        console.log(
            `  held-out pick agreement: ${describePickRecord(pick, pidAlive(pick.pid))}`
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

function pidAlive(pid: number | undefined): boolean {
    if (pid === undefined) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

type Phase = "offline" | "walk" | "all";

/** `--phase=offline|walk`; `--under-lock` alone means `offline` — the
 *  caller's hold is for the offline gates only (issue #4962). */
function phaseOf(argv: readonly string[], underLock: boolean): Phase {
    const arg = argv.find((a) => a.startsWith("--phase="));
    const v = arg?.slice("--phase=".length);
    if (v === "offline" || v === "walk") return v;
    if (v !== undefined) {
        console.error(`health-main: unknown --phase=${v} (offline|walk)`);
        process.exit(2);
    }
    return underLock ? "offline" : "all";
}

/** What a run's verdict record needs to know about the run. */
interface RunCtx {
    root: string;
    dir: string;
    branch: string;
    tip: string;
    startedAt: string;
    logPath: string;
    /** The record as it stood BEFORE this run's `running` record replaced
     *  it — what an infra verdict may have to keep (`infraRecordToKeep`). */
    previous: LastRun | null;
    /** The walk this run owes, once planned (issues #5076, #5378). */
    walkPlan?: WalkPlan;
    /** The blade audit this run owed, as `describeRobustnessMode` words it
     *  (issue #5078); carried into the walk phase from the offline record. */
    robustness?: string;
}

/** The record fields that say which walk and which blade audit the run owed. */
function walkFields(ctx: RunCtx): Pick<LastRun, "walk" | "robustness"> {
    return {
        ...(ctx.walkPlan ? { walk: describeWalkPlan(ctx.walkPlan) } : {}),
        ...(ctx.robustness ? { robustness: ctx.robustness } : {}),
    };
}

function finishInfra(
    ctx: RunCtx,
    cause: InfraCause,
    failedStep: string,
    log: string | undefined,
    halves: Pick<LastRun, "offline" | "ui">
): never {
    recordInfra<LastRun>({
        dir: ctx.dir,
        infra: {
            sha: ctx.tip,
            status: "infra",
            startedAt: ctx.startedAt,
            finishedAt: new Date().toISOString(),
            failedStep,
            infraCause: cause,
            reason: INFRA_REMEDY[cause],
            ...halves,
            ...walkFields(ctx),
            ...(log ? { log } : {}),
        },
        previous: ctx.previous,
        redMarkerStanding: existsSync(join(ctx.dir, "RED")),
    });
    console.error(
        `health-main: INFRA @ ${ctx.tip.slice(0, 8)} at ${failedStep} — ${INFRA_REMEDY[cause]}${log ? ` — ${log}` : ""}`
    );
    process.exit(1);
}

function finishRed(
    ctx: RunCtx,
    failedStep: string,
    halves: Pick<LastRun, "offline" | "ui">
): never {
    writeLast(ctx.dir, {
        sha: ctx.tip,
        status: "red",
        startedAt: ctx.startedAt,
        finishedAt: new Date().toISOString(),
        failedStep,
        log: ctx.logPath,
        ...halves,
        ...walkFields(ctx),
    });
    writeFileSync(
        join(ctx.dir, "RED"),
        `${ctx.branch} @ ${ctx.tip} red at ${failedStep} — log: ${ctx.logPath}\n`
    );
    console.error(
        `health-main: RED @ ${ctx.tip.slice(0, 8)} (${failedStep}) — ${ctx.logPath}`
    );
    process.exit(1);
}

function finishGreen(ctx: RunCtx, ui: UiWalkState): void {
    writeLast(ctx.dir, {
        sha: ctx.tip,
        status: "green",
        startedAt: ctx.startedAt,
        finishedAt: new Date().toISOString(),
        log: ctx.logPath,
        offline: "green",
        ui,
        ...walkFields(ctx),
    });
    rmSync(join(ctx.dir, "RED"), { force: true });
    // The health gate IS the authoritative green record now (ADR 0110).
    writeFileSync(
        join(ctx.root, ".claude/telemetry/green-sha"),
        `${ctx.tip}\n`
    );
    console.log(`health-main: GREEN @ ${ctx.tip.slice(0, 8)}`);
}

/**
 * The browser walk, in its own worktree at the tip the offline gates proved,
 * with no heavy-mutex hold (issue #4962): `check:ui` takes its own lane. The
 * verdict it writes is the run's ONE record — the offline half is already
 * green when this runs.
 */
async function runWalk(ctx: RunCtx, walk: readonly string[]): Promise<void> {
    writeLast(ctx.dir, {
        sha: ctx.tip,
        status: "running",
        startedAt: ctx.startedAt,
        phaseStartedAt: new Date().toISOString(),
        branch: ctx.branch,
        phase: "walk",
        offline: "green",
        ui: "walking",
        ...walkFields(ctx),
        log: ctx.logPath,
        prior: priorOf(ctx.previous),
    });
    // Wait, bounded, for a gap in the heavy mutex before `check:ui` sizes its
    // pool (issue #5024): started beside a `land` it caps itself at one
    // viewport for the whole walk. Off the mutex, never a reservation; expiry
    // walks anyway. One seam for the cadence, `release` and a by-hand run.
    await waitForWalkWindow({
        holder: () => {
            const owner = heavyHolderLive(gateLockRoot());
            return owner === null ? null : heavyHolderLine(owner);
        },
        announce: (line) => console.error(line),
    });
    // Never the caller's hold, whatever it passed: the walk is off the mutex.
    const env = healthGateEnv(process.env);
    const names = [WALK_BOOTSTRAP, ...walk];
    const steps: HealthStep[] = names.map((name, i) => ({
        ordinal: i + 1,
        total: names.length,
        name,
        cmd: "bun",
        args: healthStepArgs(name),
    }));
    const wt = join(ctx.root, "..", `tolaria-health-walk-${process.pid}`);
    let failed: { step: string; cause: InfraCause | null } | undefined;
    let walked = false;
    let current = "worktree add";
    try {
        git(["worktree", "add", "--detach", wt, ctx.tip], ctx.root);
        for (const step of steps) {
            current = step.name;
            const stepStartedAt = Date.now();
            const r = await runHealthStep(step, {
                cwd: wt,
                env,
                logPath: ctx.logPath,
            });
            if (step.name !== WALK_BOOTSTRAP) walked = true;
            if (r.ok) continue;
            failed = {
                step: step.name,
                cause: infraCause({
                    ok: false,
                    startedAt: stepStartedAt,
                    lastSleepAt: readLastSleepAt(),
                    step: step.name,
                    exitCode: r.status,
                    output: r.output,
                }),
            };
            break;
        }
    } catch (err) {
        // A throw (spawn error, full disk, a worktree that would not add)
        // must still end in a verdict: a `running` record left behind would
        // hold every health run for `STALE_RUNNING_MS`.
        console.error(
            `health-main: the walk threw at ${current}: ${String(err)}`
        );
        failed = { step: current, cause: "ui-walk" };
        walked = false;
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], {
            cwd: ctx.root,
        });
    }

    // The verdict is this run's only while the record is still its own: a
    // `bun run health` on another tip may have replaced it during the walk,
    // and writing over that one would green or red a run this one never saw.
    const now = readLast(ctx.dir);
    if (
        now?.sha !== ctx.tip ||
        now.startedAt !== ctx.startedAt ||
        now.ui !== "walking"
    ) {
        console.error(
            `health-main: the record was replaced during the walk (now ${now ? `${now.status} @ ${now.sha.slice(0, 8)}` : "none"}) — this walk's verdict is not written`
        );
        process.exit(1);
    }

    // A bootstrap that passed in the offline phase on this very sha and
    // fails here is the environment's: the walk never ran.
    if (failed && !walked)
        finishInfra(ctx, failed.cause ?? "ui-walk", failed.step, ctx.logPath, {
            offline: "green",
            ui: "not run",
        });

    if (failed === undefined) {
        finishGreen(ctx, "green");
        return;
    }
    if (failed.cause !== null)
        finishInfra(ctx, failed.cause, failed.step, ctx.logPath, {
            offline: "green",
            ui: "infra",
        });
    finishRed(ctx, failed.step, { offline: "green", ui: "red" });
}

/** `--phase=walk`: the walk the offline phase left owed, or nothing. */
async function walkPhase(root: string, dir: string): Promise<void> {
    const last = readLast(dir);
    if (
        last === null ||
        last.status !== "running" ||
        last.phase !== "walk" ||
        last.offline !== "green" ||
        // Only an OWED walk: one already walking belongs to a live process
        // (a `release` that reached its walk first) and is not walked twice.
        last.ui !== "pending"
    ) {
        console.log(
            `health-main: no walk owed${last ? ` (last: ${last.status} @ ${last.sha.slice(0, 8)})` : ""}`
        );
        return;
    }
    // An owed walk is the full one: a record from before issue #5378 may
    // still name a scoped plan, and is walked in full.
    const plan: WalkPlan = {
        kind: "full",
        reason: last.walkPlan?.reason ?? "no walk plan recorded",
    };
    await runWalk(
        {
            root,
            dir,
            branch: last.branch ?? BASE_BRANCH,
            tip: last.sha,
            startedAt: last.startedAt,
            logPath: last.log ?? join(dir, `${last.sha.slice(0, 12)}.log`),
            // The record the RUN replaced, not the `running` one between
            // its phases: an infra walk must keep a standing red record.
            previous: last.prior ?? null,
            walkPlan: plan,
            robustness: last.robustness,
        },
        splitHealthGates(HEALTH_SCRIPTS).walk
    );
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
    const phase = phaseOf(process.argv, underLock);
    if (phase === "walk") {
        await walkPhase(root, dir);
        return;
    }

    const branchArg = process.argv.find((a) => a.startsWith("--branch="));
    const branch = branchArg
        ? branchArg.slice("--branch=".length)
        : BASE_BRANCH;
    git(["fetch", "origin", branch, "-q"], root);
    const tip = git(["rev-parse", `origin/${branch}`], root);

    const last = readLast(dir);
    // `release` and an explicit `--ui-all` walk in full; nothing else walks
    // (issue #5378).
    const forceAll = process.argv.includes("--ui-all");
    // A tip batch health already proved without a full walk (skipped, or
    // scoped before issue #5378) owes it: the offline half stands, only the
    // walk runs.
    if (
        forceAll &&
        last !== null &&
        last.sha === tip &&
        last.status === "green" &&
        !walkWasFull(last)
    ) {
        console.log(
            `health-main: tip ${tip.slice(0, 8)} is green without a full walk — walking it in full`
        );
        await runWalk(
            {
                root,
                dir,
                branch,
                tip,
                startedAt: new Date().toISOString(),
                logPath: join(dir, `${tip.slice(0, 12)}.log`),
                previous: last,
                walkPlan: { kind: "full", reason: FORCED_REASON },
            },
            splitHealthGates(HEALTH_SCRIPTS).walk
        );
        return;
    }
    // Only the cadence's waiter runs `--under-lock`; by hand, a RED or INFRA
    // tip is re-gated on purpose (issue #4960).
    const skip = gateSkipReason({
        last,
        tip,
        now: Date.now(),
        retryTerminal: !underLock,
        staleMs: STALE_RUNNING_MS,
    });
    if (skip !== null) {
        console.log(`health-main: ${skip}`);
        return;
    }

    const startedAt = new Date().toISOString();
    const ctx: RunCtx = {
        root,
        dir,
        branch,
        tip,
        startedAt,
        logPath: join(dir, `${tip.slice(0, 12)}.log`),
        // Read before this run's `running` record overwrote it.
        previous: last,
    };

    writeLast(dir, {
        sha: tip,
        status: "running",
        startedAt,
        branch,
        prior: priorOf(last),
    });

    const wt = join(root, "..", `tolaria-health-${process.pid}`);
    const logPath = ctx.logPath;
    // Queues on the machine mutex, and bypasses the guard cache (issue #3646)
    // — unless the caller already took the mutex FOR the offline gates, which
    // is what the per-batch gate does (`--under-lock`, ADR 0136 §6): there the
    // offline steps pass through that one hold instead of queuing each, so
    // the block a queued `land` waits for is one block, not several. The walk
    // is never inside it (issue #4962).
    const env = healthGateEnv(process.env, { keepHold: underLock });

    const batch = batchChangedFiles(root, tip);
    const greenBase = readGreenSha(root);
    const refreshBot = batchTouchesBot(batch);
    // A batch that can have moved the blade audit also owes it (issue
    // #4875), after the rest — in full, or cut to the changed registry
    // entries (issue #5078).
    const robustness = robustnessModeFromGit({
        root,
        green: greenBase,
        tip,
        changed: batch,
    });
    console.log(`health-main: ${describeRobustnessMode(robustness)}`);
    ctx.robustness = describeRobustnessMode(robustness);
    // The audit is asked for here and run after the verdict (issue #5079).
    writeAuditRequest(dir, tip, robustness, robustnessOwed(robustness));
    // Held-out pick agreement (issue #3982) is owed by the same batches — a
    // Bot hash input moved — and is likewise measured after the verdict.
    writePickRequest(
        dir,
        tip,
        describeRobustnessMode(robustness),
        robustnessOwed(robustness)
    );
    const scripts = HEALTH_SCRIPTS;
    const gates = scripts;
    const { offline, walk } = splitHealthGates(gates);
    // The deployment `check:ui` needs, asked BEFORE ~40 minutes of gates
    // (issue #4943) — the same probe `check:ui` makes, on the URL it reads.
    // A run that owes no walk does not ask: the backend is not its business.
    const walkPlan = planHealthWalk({ forceAll });
    const preflight = await convexPreflight({
        gates: walkPlan.kind === "skipped" ? offline : gates,
        url: process.env.VITE_CONVEX_URL ?? readEnvLocal(root).VITE_CONVEX_URL,
        probe: (url) => reachable(url, 5000),
    });
    if (preflight !== null)
        finishInfra(ctx, preflight, PREFLIGHT_CONVEX_STEP, undefined, {
            ui: "not run",
        });

    // The machine, asked before ~40 minutes of gates start on it (issue
    // #4966). Under a caller's hold the gate that took the mutex has already
    // asked, and waited: asking again would only wait twice. With no hold
    // (`release`, by hand) a running heavy gate's load is not waited on
    // (issue #4988): every step below queues for the mutex behind it and
    // asks again under its own hold, so waiting here only adds a bound that
    // holder can outlast.
    const thresholds = readMachineConfig();
    if (process.env.TOLARIA_GATE_HELD !== "1") {
        const machine = await waitForMachine({
            thresholds,
            tag: "health-main:",
            announce: (line) => console.error(line),
            heavyHolder: () => runningHolderLine(gateLockRoot()),
        });
        if (!machine.admitted)
            finishInfra(
                ctx,
                "machine-saturated",
                PREFLIGHT_MACHINE_STEP,
                undefined,
                { ui: "not run" }
            );
    }

    const steps: HealthStep[] = offline.map((name, i) => ({
        ordinal: i + 1,
        total: offline.length,
        name,
        cmd: "bun",
        args: healthStepArgs(name),
    }));

    const refreshSteps = refreshBot ? botRefreshSteps(steps.length, root) : [];
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
            const machineAtStart = readMachineSample();
            const r = await runHealthStep(step, { cwd: wt, env, logPath });
            if (!r.ok) {
                // Read at once: a later sleep must not reach back to this step.
                failedCause = infraCause({
                    ok: false,
                    startedAt: stepStartedAt,
                    lastSleepAt: readLastSleepAt(),
                    step: step.name,
                    exitCode: r.status,
                    output: r.output,
                    machineSaturated: runSaturated(
                        [machineAtStart, readMachineSample()],
                        thresholds
                    ),
                });
                // The machine's excuse does not repeat: the same step timing
                // out on two runs in a row is the tree's.
                if (
                    failedCause === "machine-timeout" &&
                    repeatedMachineTimeout(last, step.name)
                )
                    failedCause = null;
                failedStep = step.name;
                break;
            }
        }
        // The walk this run owes, once the offline gates proved the tip:
        // none for a batch, the full one under `--ui-all` (issue #5378).
        if (failedStep === undefined && walk.length > 0) {
            ctx.walkPlan = walkPlan;
            console.log(
                `health-main: walk plan — ${describeWalkPlan(ctx.walkPlan)}`
            );
        }
        // Only a batch that passed re-measures, and a refresh that fails or
        // is cut short leaves the page stale (marked so) instead of the tip
        // red: the measurement is a view of the Bot, not a gate on it. It
        // stays in this phase: `bot:reach` takes the heavy mutex.
        if (failedStep === undefined) {
            try {
                let refreshed = refreshSteps.length > 0;
                for (const step of refreshSteps) {
                    // Filing commits and pushes the allowlist from the primary
                    // checkout and reads ITS tree: only when that tree is the
                    // measured tip (issue #4944). Otherwise the next batch files.
                    if (
                        step.name === FILING_STEP_NAME &&
                        spawnSync("git", ["rev-parse", "HEAD"], {
                            cwd: root,
                            encoding: "utf8",
                        }).stdout.trim() !== tip
                    ) {
                        console.error(
                            `health-main: ${step.name} skipped — the primary checkout is not at the measured tip ${tip.slice(0, 12)}; Bot Gaps file next batch`
                        );
                        break;
                    }
                    const r = await runHealthStep(step, {
                        cwd: step.cwd ?? wt,
                        env,
                        logPath,
                    });
                    if (!r.ok && step.name === FILING_STEP_NAME) {
                        // Filing is the refresh's last act and no part of the
                        // measurement: the page is fresh, the gaps file next run.
                        console.error(
                            `health-main: ${step.name} failed — Bot Gaps not filed this batch (${logPath})`
                        );
                        break;
                    }
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
        finishInfra(ctx, failedCause, failedStep, logPath, {
            offline: "infra",
            ui: "not run",
        });
    if (failedStep)
        finishRed(ctx, failedStep, { offline: "red", ui: "not run" });

    if (walk.length === 0) {
        finishGreen(ctx, "not run");
        return;
    }
    if (ctx.walkPlan?.kind === "skipped") {
        // The offline half alone decides GREEN; `release` walks this tip in
        // full before it trusts it (`walkWasFull`, issue #5378).
        finishGreen(ctx, "skipped");
        return;
    }
    if (phase === "offline") {
        // The walk is owed and the caller's hold must end first: the record
        // says so, and `--phase=walk` picks it up (`health-cadence detach`).
        writeLast(dir, {
            sha: tip,
            status: "running",
            startedAt,
            phaseStartedAt: new Date().toISOString(),
            branch,
            phase: "walk",
            offline: "green",
            ui: "pending",
            ...walkFields(ctx),
            walkPlan: ctx.walkPlan,
            log: logPath,
            prior: priorOf(last),
        });
        console.log(
            `health-main: offline gates GREEN @ ${tip.slice(0, 8)} — the walk is owed (--phase=walk, off the heavy mutex)`
        );
        return;
    }
    await runWalk(ctx, walk);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
