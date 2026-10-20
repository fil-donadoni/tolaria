#!/usr/bin/env bun
/**
 * The full health gate for a branch tip (ADR 0110, re-homed by ADR 0116).
 *
 * `land` runs the LANE gate only; `bun run release` runs this script on the
 * base branch tip before fast-forwarding the release branch, `health.yml`
 * runs it on a schedule (ADR 0156 §4), and `bun run health` runs it by hand. It runs the FULL gate
 * (`HEALTH_SCRIPTS` in `lib/health-step.ts`: `check:all`, the derived Op census
 * `check:gaps`, the Coverage Invariant `check:targets`, the test-suite
 * hygiene census `check:test-hygiene`, all three test suites, and — under
 * `--ui-all`, which `release` passes, and only then — the full `check:ui`
 * browser walk: a batch run owes none (`lib/health-walk-plan.ts`, issue
 * #5378)) against the merged tip, in a throwaway worktree, and leaves a
 * durable verdict in `.claude/telemetry/health/`:
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
 * up and writes the run's ONE verdict. A caller holding `gate.ts yield` runs
 * the first under that hold and the second after releasing it, so no `land`
 * queues behind a browser walk. With no `--phase` (`release`, by hand)
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
 * rather than each queue for it — what a caller passes under a single
 * `gate.ts yield` acquisition (ADR 0136 §6); `release` never does. It
 * implies `--phase=offline`: a hold is never carried into the walk.
 *
 * Each step reports to the terminal while it runs (issue #3487) — start and
 * end lines, the gate's `[gate]` mutex-wait lines live, a liveness line while
 * a step is long — and the per-sha log still receives the full child output.
 * `lib/health-step.ts` owns that.
 *
 * The Bot Findings refresh (`bot:reach`, `seed:bot-findings`, `gaps:sync`)
 * and the blade robustness / held-out pick agreement audits are NOT part of
 * this run (issue #5458): they keep a view of the Bot fresh and prove nothing
 * about the tree, so `bun run health:nightly` (`scripts/health-nightly.ts`, a
 * cron entry point) runs the refresh nightly and the audits weekly. Nor is
 * `check:convex-heap`, a capacity report run by hand (`bun run maintenance`).
 * The offline phase is `worktree:init`, `check:all`, the cheap guards, `test`.
 *
 * JOB RUNS (issue #5645, `lib/health-verdict-job.ts`). `--scheduled` is
 * `health.yml`'s two-hourly run on a `lane` runner, from the job's worktree
 * of the primary checkout (the one linked worktree health accepts); it
 * re-gates an INFRA only with `--retry-infra` and never a tip the store holds
 * a RED for. `--early` is `health-early.yml`'s run on a GitHub-hosted runner
 * after a batch of merges: the same offline gate minus the committed-corpus
 * tests, so only its RED reaches the store. A RED of either goes through the
 * ladder (`scripts/health-bisect.ts`): a fresh run, then the bisect.
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
 * `lib/deployment-skew.ts` (builtins), `lib/machine-admission.ts` (builtins and `lib/branches.ts`),
 * `lib/health-robustness-audit.ts` and `lib/health-pick-agreement-audit.ts`
 * (their records, for `--status`), `lib/test-headroom.ts` (builtins), and
 * through `lib/health-verdict.ts` the
 * `ui-gate/infra-verdict.ts` (builtins and `lib/convex-reachable.ts`),
 * `lib/health-verdict-job.ts` and `lib/corpus-exclusion.ts` (builtins) — same
 * constraint as bootstrap-worktree.
 */
import { spawnSync } from "node:child_process";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import {
    describePickRecord,
    readPickRecord,
} from "./lib/health-pick-agreement-audit";
import {
    describeAuditRecord,
    readAuditRecord,
} from "./lib/health-robustness-audit";
import {
    retryNote,
    runStepWithRetry,
    type RetryCause,
} from "./lib/health-retry";
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
    PREFLIGHT_SKEW_STEP,
    readLastSleepAt,
    recordInfra,
    repeatedMachineTimeout,
    type HealthStatus,
    type InfraCause,
    type UiWalkState,
} from "./lib/health-verdict";
import { reachable, readEnvLocal } from "./lib/convex-reachable";
import { readDeploymentSkew } from "./lib/deployment-skew";
import { buildEvidence, evidenceSummary } from "./lib/health-evidence";
import {
    evidenceStore,
    lineageBlocks,
    machineName,
    readVerdictLineage,
    verdictAgeMs,
    verdictStore,
    type Verdict,
} from "./lib/health-verdict-store";
import { publishRunMarker } from "./lib/health-pivot";
import { waitForWalkWindow } from "./lib/health-walk-wait";
import { readUiWalkGating, writeWalkVerdict } from "./lib/health-verdict-walk";
import {
    describeWalkPlan,
    walkDisposition,
    walkOutcome,
    type WalkOutcome,
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
    runSaturated,
    waitForMachine,
} from "./lib/machine-admission";
import { gateSkipReason } from "./lib/health-gate-skip";
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    DURATIONS_ENV,
    headroomLine,
    readDurations,
    RUN_FILE,
} from "./lib/test-headroom";
import { corpusExcluded, refuseCorpusExclusion } from "./lib/corpus-exclusion";
import {
    earlyRunRefusal,
    healthRunMode,
    inJobWorktree,
    storesVerdict,
    unattendedSkip,
    type HealthRunMode,
} from "./lib/health-verdict-job";

const HEALTH_DIR = ".claude/telemetry/health";
const STALE_RUNNING_MS = 90 * 60 * 1000;
/** Per-sha test durations under `HEALTH_DIR` (issue #5484). */
const DURATIONS_DIR = "durations";

interface LastRun {
    sha: string;
    status: HealthStatus;
    startedAt: string;
    finishedAt?: string;
    failedStep?: string;
    log?: string;
    /** `red` only: the failing test files (`failedTestFiles`) — what a
     *  repair's lane must run before the lineage turns AMBER (issue #5462). */
    tests?: string[];
    /** `red` only: the failure's kind (`FailureKind`, issue #5589). */
    failure?: string;
    /** `red` only: where the evidence was published — the pivot's URL, or
     *  the local file on the file backend (issue #5589). */
    evidence?: string;
    /** The vitest projects a failed `test` step re-ran once (issue #5461):
     *  on a `green` the flake the retry absorbed, on a `red` what failed
     *  twice. `health:status` prints it. */
    retried?: string[];
    /** Set with `retried` (issue #5484): what the first failure was — a
     *  `timeout` that passed on the retry is a near-miss on its budget. */
    retryCause?: RetryCause;
    /** `red` only, never with `retried`: why the failed step was not re-run
     *  (issue #5939) — the evidence names it. */
    retryRefused?: string;
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

/** The verdict the shared store holds for `sha`; an unreadable store reads as
 *  none (the local record still decides), loudly. */
function readStoredVerdict(root: string, sha: string): Verdict | null {
    try {
        return verdictStore(root).read(sha);
    } catch (e) {
        console.error(
            `health-main: the verdict store could not be read — ${(e as Error).message}`
        );
        return null;
    }
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

/**
 * `health:status --json` (issue #5462): the store's lineage as ONE line of
 * flat JSON, for `loop-drain.sh` to read with `sed`. Exit 0 whenever the
 * store answered — the verdict is in `lineage`, not in the exit code — and 2
 * when it could not be read (`error`), which the loop reports and survives.
 */
function statusJson(root: string): never {
    const lineage = readVerdictLineage(() => verdictStore(root));
    const v = lineage.verdict;
    const line: Record<string, string | number | null> = {
        lineage: lineage.kind,
        sha: v?.sha ?? null,
        status: v?.status ?? null,
        step: v?.step ?? null,
        machine: v?.machine ?? null,
        log: v?.log ?? null,
        failure: v?.failure ?? null,
        tests: v?.tests?.join(",") ?? null,
        reason: v?.reason ?? null,
        ageMs: verdictAgeMs(v, Date.now()),
        error: lineage.error ?? null,
    };
    // One line, flat, quotes stripped from values: `sed` reads it.
    for (const [k, val] of Object.entries(line))
        if (typeof val === "string") line[k] = val.replace(/["\\\n]/g, " ");
    console.log(JSON.stringify(line));
    process.exit(lineage.error ? 2 : 0);
}

/**
 * The RED's evidence, read from the PIVOT (issue #5589) — never from a
 * `log` path, which names a file on the machine that ran the gate. `full`
 * prints the whole body (`health:status --evidence`, what `/health-fix`
 * § 0 reads); otherwise its summary.
 */
function printEvidence(root: string, sha: string, full: boolean): boolean {
    let body: string | null = null;
    try {
        body = evidenceStore(root).read(sha);
    } catch (err) {
        console.log(`  evidence: UNREADABLE — ${String(err)}`);
        return false;
    }
    if (body === null) {
        console.log(
            `  evidence: none published for ${sha.slice(0, 8)} (a RED written before issue #5589, or a publish that failed — health-main's output says)`
        );
        return false;
    }
    if (full) console.log(body);
    else
        console.log(
            `${evidenceSummary(body)
                .split("\n")
                .map((l) => `  ${l}`)
                .join(
                    "\n"
                )}\n  full evidence: bun run health:status --evidence ${sha.slice(0, 12)}`
        );
    return true;
}

/** `health:status --evidence [sha]`: the standing RED's evidence (or the
 *  named sha's), whole. Exit 0 when printed, 1 when there is none. */
function evidence(root: string): never {
    const i = process.argv.indexOf("--evidence");
    const arg = process.argv[i + 1];
    let sha = arg && !arg.startsWith("-") ? arg : undefined;
    if (sha === undefined) {
        const lineage = readVerdictLineage(() => verdictStore(root));
        if (lineage.error) {
            console.error(
                `health:status: the verdict store could not be read — ${lineage.error}`
            );
            process.exit(2);
        }
        if (!lineage.verdict || lineage.verdict.status !== "red") {
            console.error(
                `health:status: no RED stands (${lineage.kind}) — name a sha: --evidence <sha>`
            );
            process.exit(1);
        }
        sha = lineage.verdict.sha;
    } else if (sha.length < 40) {
        const r = spawnSync("git", ["rev-parse", sha], {
            cwd: root,
            encoding: "utf8",
        });
        if (r.status === 0) sha = r.stdout.trim();
    }
    process.exit(printEvidence(root, sha, true) ? 0 : 1);
}

function status(root: string): never {
    if (process.argv.includes("--json")) statusJson(root);
    if (process.argv.includes("--evidence")) evidence(root);
    const dir = join(root, HEALTH_DIR);
    const last = readLast(dir);
    const lineage = readVerdictLineage(() => verdictStore(root));
    const red = lineage.kind === "red" || lineage.kind === "second-red";
    console.log("health:status —", root);
    console.log(
        `  verdict store: ${lineage.error ? `UNREADABLE — ${lineage.error}` : `${lineage.kind.toUpperCase()}${lineage.verdict ? ` @ ${lineage.verdict.sha.slice(0, 8)}${lineage.verdict.machine ? ` (${lineage.verdict.machine})` : ""}` : ""}`}`
    );
    if (red && lineage.verdict) {
        const v = lineage.verdict;
        console.log(
            `  RED: ${v.step ?? "unknown step"}${v.failure ? ` — ${v.failure}` : ""}${v.tests?.length ? ` — ${v.tests.join(", ")}` : ""}`
        );
        printEvidence(root, v.sha, false);
    }
    if (!last) console.log("  no health run recorded yet");
    else
        console.log(
            `  last: ${last.status.toUpperCase()} @ ${last.sha.slice(0, 8)} (started ${last.startedAt}${last.finishedAt ? `, finished ${last.finishedAt}` : ""})${last.failedStep ? ` — failed at ${last.failedStep}` : ""}${last.retried ? `\n  retry: ${retryNote("test", last.retried, last.retryCause)} — ${retryOutcome(last)}` : ""}${last.reason ? `\n  why:  ${last.reason}` : ""}${last.log ? `\n  log:  ${last.log}` : ""}`
        );
    // The two halves, each on its own (issue #4962): a walk the environment
    // cut short says so instead of hiding inside the run's single status.
    if (last)
        console.log(
            `  offline: ${last.offline ?? "unrecorded"} · ui: ${last.ui ?? "unrecorded"}${last.walk ? `\n  walk: ${last.walk}` : ""}`
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
    /** The projects the offline `test` step re-ran once (issue #5461), and
     *  what their first failure was (issue #5484). */
    retry?: RetryFields;
    /** A job run (`lib/health-verdict-job.ts`, issue #5645): `early` writes
     *  only its RED to the store. Absent: `default`. */
    mode?: HealthRunMode;
}

/** The retry half of a record (issues #5461, #5484, #5939). */
type RetryFields = Pick<LastRun, "retried" | "retryCause" | "retryRefused">;

/** What `health:status` says of a retried step. */
function retryOutcome(last: LastRun): string {
    if (last.status !== "green") return "failed twice";
    return last.retryCause === "timeout"
        ? "timed out once, passed on the re-run (a near-miss on its testTimeout — see the log's headroom: line)"
        : "failed once, passed on the re-run (a flake)";
}

/** This run's per-test durations directory, emptied: a re-gated sha must not
 *  mix two runs' measurements (issue #5484). */
function freshDurationsDir(dir: string, tip: string): string {
    const d = join(dir, DURATIONS_DIR, tip.slice(0, 12));
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    return d;
}

/**
 * Test timeout headroom (issue #5484), ADVISORY: seals the run's durations
 * for `telemetry:ingest` (`RUN_FILE`) and, when a test ran above
 * `HEADROOM_THRESHOLD` of its `testTimeout`, ends the log with the
 * `headroom:` line. The verdict is decided from the steps' exits before and
 * after this, never from it — and this never throws.
 */
function reportHeadroom(durDir: string, logPath: string): void {
    try {
        writeFileSync(
            join(durDir, RUN_FILE),
            JSON.stringify({
                machine: machineName(),
                ts: Math.floor(Date.now() / 1000),
            })
        );
        const line = headroomLine(readDurations(durDir));
        if (line === null) return;
        appendFileSync(logPath, `${line}\n`);
        console.log(`health-main: ${line}`);
    } catch (err) {
        console.error(
            `health-main: headroom not reported (advisory) — ${String(err)}`
        );
    }
}

/** The record field that says which walk the run owed. */
function walkFields(ctx: RunCtx): Pick<LastRun, "walk"> {
    return ctx.walkPlan ? { walk: describeWalkPlan(ctx.walkPlan) } : {};
}

/**
 * The verdict, through the store `tolaria.config.json` selects (issue
 * #5462): the `RED` / `AMBER` markers on the file backend, a commit status on
 * the github one. `last.json` above stays this run's own record either way.
 * Never fatal: the local record is already written, and a store GitHub could
 * not take is reported, not allowed to turn a verdict into a crash.
 */
function publishVerdict(
    ctx: RunCtx,
    verdict: Omit<Verdict, "machine" | "at">
): void {
    if (!storesVerdict(ctx.mode ?? "default", verdict.status as HealthStatus)) {
        console.log(
            `health-main: early run — ${String(verdict.status).toUpperCase()} stays in this runner's record, never the store (it skipped the corpus tests)`
        );
        return;
    }
    try {
        const out = verdictStore(ctx.root, { branch: ctx.branch }).write({
            ...verdict,
            machine: machineName(),
            at: new Date().toISOString(),
        });
        if (!out.written)
            console.error(
                `health-main: verdict store kept its record — ${out.reason}`
            );
    } catch (err) {
        console.error(
            `health-main: the verdict store could not be written — ${String(err)}`
        );
    }
}

/**
 * The walk's own verdict, under `context=ui-walk` (issue #5465), machine
 * named — written whether or not the walk gates. Never fatal.
 */
function publishWalk(
    ctx: RunCtx,
    outcome: WalkOutcome,
    failedStep: string | undefined
): void {
    try {
        const out = writeWalkVerdict(ctx.root, {
            sha: ctx.tip,
            status:
                outcome === "green"
                    ? "green"
                    : outcome === "red"
                      ? "red"
                      : "infra",
            ...(failedStep ? { step: failedStep } : {}),
            log: ctx.logPath,
            machine: machineName(),
            at: new Date().toISOString(),
        });
        if (!out.written)
            console.error(
                `health-main: ui-walk verdict not kept — ${out.reason}`
            );
    } catch (err) {
        console.error(
            `health-main: the ui-walk verdict could not be written — ${String(err)}`
        );
    }
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
        // A RED stands on the store (`readVerdictLineage` is total: an
        // unreadable store reads as none, and the infra record is written).
        redMarkerStanding: lineageBlocks(
            readVerdictLineage(() =>
                verdictStore(ctx.root, { branch: ctx.branch })
            ).kind
        ),
    });
    publishVerdict(ctx, {
        sha: ctx.tip,
        status: "infra",
        step: failedStep,
        reason: INFRA_REMEDY[cause],
        ...(log ? { log } : {}),
    });
    console.error(
        `health-main: INFRA @ ${ctx.tip.slice(0, 8)} at ${failedStep} — ${INFRA_REMEDY[cause]}${log ? ` — ${log}` : ""}`
    );
    process.exit(1);
}

/** What the failed step printed — the evidence's raw material. */
interface FailedOutput {
    output: string;
    status: number | null;
    signal: string | null;
}

/**
 * Publishes the RED's evidence on the pivot (issue #5589) and returns what
 * the verdict carries: the failing files, the failure's kind, and the
 * pointer the OTHER machine can read. Never fatal: evidence that could not
 * be published leaves the kind and the files in the verdict, and the local
 * log as its pointer, as before.
 */
function publishEvidence(
    ctx: RunCtx,
    step: string,
    failed: FailedOutput,
    retry?: RetryFields
): { tests: string[]; failure: string; pointer: string } {
    const ev = buildEvidence({
        sha: ctx.tip,
        step,
        machine: machineName(),
        logPath: ctx.logPath,
        ...failed,
        retried: retry?.retried,
        retryCause: retry?.retryCause,
        retryRefused: retry?.retryRefused,
        at: new Date().toISOString(),
    });
    let pointer = ctx.logPath;
    try {
        pointer = evidenceStore(ctx.root).publish(ctx.tip, ev.body);
    } catch (err) {
        console.error(
            `health-main: the RED evidence could not be published — ${String(err)}`
        );
    }
    console.error(evidenceSummary(ev.body));
    return { tests: ev.files, failure: ev.kind, pointer };
}

function finishRed(
    ctx: RunCtx,
    failedStep: string,
    halves: Pick<LastRun, "offline" | "ui">,
    failed: FailedOutput,
    retry?: RetryFields
): never {
    const ev = publishEvidence(ctx, failedStep, failed, retry);
    const tests = ev.tests;
    if (retry?.retried)
        failedStep = retryNote(failedStep, retry.retried, retry.retryCause);
    writeLast(ctx.dir, {
        sha: ctx.tip,
        status: "red",
        startedAt: ctx.startedAt,
        finishedAt: new Date().toISOString(),
        failedStep,
        log: ctx.logPath,
        ...(tests.length > 0 ? { tests } : {}),
        failure: ev.failure,
        evidence: ev.pointer,
        ...retry,
        ...halves,
        ...walkFields(ctx),
    });
    publishVerdict(ctx, {
        sha: ctx.tip,
        status: "red",
        step: failedStep,
        // The pointer EITHER machine can read; the local path rides in the
        // evidence body (issue #5589).
        log: ev.pointer,
        failure: ev.failure,
        ...(tests.length > 0 ? { tests } : {}),
    });
    const lineage = readVerdictLineage(() =>
        verdictStore(ctx.root, { branch: ctx.branch })
    );
    if (lineage.kind === "second-red")
        console.error(
            "health-main: SECOND RED on this lineage — the repair did not hold (the loop stops and notifies)"
        );
    console.error(
        `health-main: RED @ ${ctx.tip.slice(0, 8)} (${failedStep}) — ${ctx.logPath}`
    );
    process.exit(1);
}

function finishGreen(ctx: RunCtx, ui: UiWalkState, retry?: RetryFields): void {
    const note = retry?.retried
        ? retryNote("test", retry.retried, retry.retryCause)
        : undefined;
    writeLast(ctx.dir, {
        sha: ctx.tip,
        status: "green",
        startedAt: ctx.startedAt,
        finishedAt: new Date().toISOString(),
        log: ctx.logPath,
        offline: "green",
        ui,
        ...retry,
        ...walkFields(ctx),
    });
    publishVerdict(ctx, {
        sha: ctx.tip,
        status: "green",
        ...(note ? { step: note } : {}),
        log: ctx.logPath,
    });
    // The health gate IS the authoritative green record now (ADR 0110) —
    // an early run's GREEN is none (it skipped the corpus tests).
    if (ctx.mode !== "early")
        writeFileSync(
            join(ctx.root, ".claude/telemetry/green-sha"),
            `${ctx.tip}\n`
        );
    console.log(
        `health-main: GREEN @ ${ctx.tip.slice(0, 8)}${note ? ` (${note} — ${retry?.retryCause === "timeout" ? "a near-miss" : "a flake"}, see ${ctx.logPath})` : ""}`
    );
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
    // The deployment serves the PRIMARY checkout's convex/ tree (issue
    // #6132): one that is not the tip's would fail every game cell on a green
    // tree. Seconds, before any worktree or browser; `check:ui` re-checks it
    // through the walk (issue #6133).
    const skew = walkSkew(ctx);
    if (skew !== null) {
        console.error(`health-main: deployment skew — ${skew}`);
        publishWalk(ctx, "infra", PREFLIGHT_SKEW_STEP);
        if (walkDisposition(readUiWalkGating()) === "advisory") {
            finishGreen(ctx, "advisory", ctx.retry);
            return;
        }
        finishInfra(ctx, "deployment-skew", PREFLIGHT_SKEW_STEP, ctx.logPath, {
            offline: "green",
            ui: "not run",
        });
    }
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
    let failed:
        | { step: string; cause: InfraCause | null; out: FailedOutput }
        | undefined;
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
                out: { output: r.output, status: r.status, signal: r.signal },
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
        failed = {
            step: current,
            cause: "ui-walk",
            out: { output: String(err), status: null, signal: null },
        };
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
    const outcome = walkOutcome({
        failed: failed !== undefined,
        walked,
        environmental: failed !== undefined && failed.cause !== null,
    });
    publishWalk(ctx, outcome, failed?.step);
    // An advisory walk (a Linux machine until calibrated, issue #5465) never
    // reaches the health verdict: the offline half stands as GREEN.
    if (walkDisposition(readUiWalkGating()) === "advisory") {
        finishGreen(ctx, "advisory", ctx.retry);
        return;
    }

    if (failed && !walked)
        finishInfra(ctx, failed.cause ?? "ui-walk", failed.step, ctx.logPath, {
            offline: "green",
            ui: "not run",
        });

    if (failed === undefined) {
        finishGreen(ctx, "green", ctx.retry);
        return;
    }
    if (failed.cause !== null)
        finishInfra(ctx, failed.cause, failed.step, ctx.logPath, {
            offline: "green",
            ui: "infra",
        });
    finishRed(ctx, failed.step, { offline: "green", ui: "red" }, failed.out);
}

/**
 * Why the deployment does not serve the tip's Convex code, or null when it
 * does (`lib/deployment-skew.ts`, issue #6132). A git failure reads as no
 * skew, loudly: `check:ui` makes the same comparison before its first cell.
 */
function walkSkew(ctx: RunCtx): string | null {
    try {
        const d = readDeploymentSkew({
            primary: ctx.root,
            base: BASE_BRANCH,
            walked: { dir: ctx.root, rev: ctx.tip },
        });
        return d.kind === "skew" ? d.reason : null;
    } catch (err) {
        console.error(
            `health-main: the deployment-skew preflight could not read git — ${(err as Error).message}`
        );
        return null;
    }
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
            retry: { retried: last.retried, retryCause: last.retryCause },
        },
        splitHealthGates(HEALTH_SCRIPTS).walk
    );
}

async function main(): Promise<void> {
    // A gating run never skips the committed-corpus tests (issue #5675) —
    // refused before the lease; `--status` only reads. The one exception is
    // the hosted early run (issue #5645), which writes no GREEN.
    const mode = healthRunMode(process.argv);
    if (mode === "early") {
        const refusal = earlyRunRefusal(process.env, corpusExcluded());
        if (refusal !== null) {
            console.error(`health-main: ${refusal}`);
            process.exit(2);
        }
    } else if (!process.argv.includes("--status"))
        refuseCorpusExclusion("health");
    const cwd = process.cwd();
    // A status read outside a checkout reads `cwd` (the loop driver's tests
    // run it in a bare directory); everything else needs the repository.
    if (process.argv.includes("--status")) {
        let statusRoot = cwd;
        try {
            statusRoot = primaryCheckout(cwd) ?? cwd;
        } catch {
            // not a git checkout — `cwd` is the root
        }
        status(statusRoot);
    }
    const primary = primaryCheckout(cwd);
    const root = primary ?? cwd;

    // A self-hosted job's worktree of the primary is the job itself (issue
    // #5645): the records still go to the primary (`root`).
    if (primary !== null && !inJobWorktree(cwd, process.env)) {
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
    // An early run never walks: a hosted runner has no deployment.
    const forceAll = process.argv.includes("--ui-all") && mode !== "early";
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
    // tip is re-gated on purpose (issue #4960). The health runner's waiter
    // passes `--retry-infra` (issue #5467): it re-fires only past its own
    // dedup, and an INFRA tip proves nothing — skipping it would leave the
    // tip unproven until the next landing.
    const retryInfra =
        process.argv.includes("--retry-infra") && last?.status === "infra";
    const stored = readStoredVerdict(root, tip);
    // A job run is unattended (issue #5645): like the cadence's waiter it
    // re-gates an INFRA only on `--retry-infra`, and never a stored RED.
    const skip =
        unattendedSkip(mode, tip, stored) ??
        gateSkipReason({
            last,
            tip,
            stored,
            now: Date.now(),
            retryTerminal:
                mode === "default" ? !underLock || retryInfra : retryInfra,
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
        mode,
    };

    writeLast(dir, {
        sha: tip,
        status: "running",
        startedAt,
        branch,
        prior: priorOf(last),
    });
    // The other machine's cadence reads this, not `last.json` (issue #5593)
    // — never for an early run, which proves no GREEN the cadence could wait on.
    if (mode !== "early") publishRunMarker(root, tip);

    const wt = join(root, "..", `tolaria-health-${process.pid}`);
    const logPath = ctx.logPath;
    // Queues on the machine mutex, and bypasses the guard cache (issue #3646)
    // — unless the caller already took the mutex FOR the offline gates, which
    // is what the per-batch gate does (`--under-lock`, ADR 0136 §6): there the
    // offline steps pass through that one hold instead of queuing each, so
    // the block a queued `land` waits for is one block, not several. The walk
    // is never inside it (issue #4962).
    const env = healthGateEnv(process.env, { keepHold: underLock });
    // Every vitest invocation of the run writes its per-test durations here
    // (`lib/vitest-duration-reporter.ts`, issue #5484) — measured, never
    // asserted.
    // Advisory: a directory that cannot be made costs the measurement, never
    // the run.
    let durDir: string | null = null;
    try {
        durDir = freshDurationsDir(dir, tip);
        env[DURATIONS_ENV] = durDir;
    } catch (err) {
        console.error(
            `health-main: no test durations this run (advisory) — ${String(err)}`
        );
    }

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

    let failedStep: string | undefined;
    let failedOutput: FailedOutput = { output: "", status: null, signal: null };
    let failedCause: InfraCause | null = null;
    let retry: RetryFields | undefined;
    try {
        git(["worktree", "add", "--detach", wt, tip], root);
        for (const step of steps) {
            const stepStartedAt = Date.now();
            const run = await runStepWithRetry(
                step,
                (s) => runHealthStep(s, { cwd: wt, env, logPath }),
                (line) => process.stdout.write(line)
            );
            const r = run.result;
            if (run.retried)
                retry = { retried: run.retried, retryCause: run.cause };
            else if (run.refused) retry = { retryRefused: run.refused };
            if (!r.ok) {
                // Read at once: a later sleep must not reach back to this step.
                failedCause = infraCause({
                    ok: false,
                    startedAt: stepStartedAt,
                    lastSleepAt: readLastSleepAt(),
                    step: step.name,
                    exitCode: r.status,
                    output: r.output,
                    // The machine of the run whose failure this classifies —
                    // the retry's, when there was one: its start, every
                    // liveness beat, its end (issue #5939).
                    machineSaturated: runSaturated(r.samples ?? [], thresholds),
                });
                // The machine's excuse does not repeat: the same step timing
                // out on two runs in a row is the tree's.
                if (
                    failedCause === "machine-timeout" &&
                    repeatedMachineTimeout(last, step.name)
                )
                    failedCause = null;
                failedStep = step.name;
                failedOutput = {
                    output: r.output,
                    status: r.status,
                    signal: r.signal,
                };
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
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }
    if (durDir !== null) reportHeadroom(durDir, logPath);

    if (failedStep && failedCause !== null)
        finishInfra(ctx, failedCause, failedStep, logPath, {
            offline: "infra",
            ui: "not run",
        });
    if (failedStep)
        finishRed(
            ctx,
            failedStep,
            { offline: "red", ui: "not run" },
            failedOutput,
            retry
        );

    if (walk.length === 0) {
        finishGreen(ctx, "not run", retry);
        return;
    }
    if (ctx.walkPlan?.kind === "skipped") {
        // The offline half alone decides GREEN; `release` walks this tip in
        // full before it trusts it (`walkWasFull`, issue #5378).
        finishGreen(ctx, "skipped", retry);
        return;
    }
    if (phase === "offline") {
        // The walk is owed and the caller's hold must end first: the record
        // says so, and `--phase=walk` picks it up.
        writeLast(dir, {
            sha: tip,
            status: "running",
            startedAt,
            phaseStartedAt: new Date().toISOString(),
            branch,
            phase: "walk",
            offline: "green",
            ui: "pending",
            ...retry,
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
