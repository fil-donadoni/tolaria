/**
 * The health gate's step runner (issue #3487).
 *
 * `health-main.ts` runs three long steps in series, and each child's output is
 * the per-sha log's business, not the terminal's. It used to be captured
 * wholesale by `spawnSync`, which made a queued gate, a running `test:bot` and
 * a wedged process one indistinguishable blank terminal for 10+ minutes. This
 * runner keeps the log byte-identical to that capture and adds, on `out`:
 *
 *   - a START line before the child runs (`[2/3] check:all — start`),
 *   - every `[gate] …` line the child prints, LIVE — the mutex-wait lines
 *     exist precisely to tell a queue from a hang, and they were swallowed,
 *   - a liveness line every `livenessMs` while the step runs — and a machine
 *     reading with it, beside one at each edge (issue #5939),
 *   - an END line with the exit status and the wall-clock elapsed.
 *
 * Plain appended lines, no TTY tricks, so the output stays greppable.
 *
 * Node builtins plus `lib/health-verdict.ts` and `lib/machine-admission.ts`
 * (which `health-verdict.ts` already loads) — `health-main.ts` carries the
 * same constraint.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isWalkStep } from "./health-verdict";
import { readMachineSample, type MachineSample } from "./machine-admission";

export interface HealthStep {
    /** 1-based position in the run, and the run's step count. */
    ordinal: number;
    total: number;
    /** What the terminal lines and the RED verdict call this step. */
    name: string;
    cmd: string;
    args: string[];
    /** Run here instead of the batch worktree (`StepRunOptions.cwd`) — a step
     *  that writes to the primary checkout (`gaps:sync`, issue #4944). */
    cwd?: string;
    /** Extra environment for this step only, over `StepRunOptions.env`
     *  (`BLADE_ROBUSTNESS_LABELS`, issue #5078). */
    env?: Record<string, string>;
}

export interface StepRunOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    /** Per-sha log — receives the child's full output, as the old capture did. */
    logPath: string;
    /** Where the progress lines go (one call per line, newline included). */
    out?: (line: string) => void;
    /** Interval between liveness lines while the step runs. */
    livenessMs?: number;
    /** Read before the spawn, on each liveness line and at the close (issue
     *  #5939); the machine by default. */
    sample?: () => MachineSample;
}

export interface StepResult {
    ok: boolean;
    /** Child exit code; null when it died on a signal (as `spawnSync` reported). */
    status: number | null;
    /** The signal that killed it, when one did — an OOM-killed `test` says so. */
    signal: NodeJS.Signals | null;
    elapsedMs: number;
    /** The child's stdout then stderr, as the log received them — what the
     *  walk's verdict is read from (`walkRunVerdict`, issue #4962). */
    output: string;
    /**
     * THIS run's machine: one reading before the spawn, one per liveness
     * line, one at the close — what `runSaturated` reads to excuse a
     * timeout-only failure as `machine-timeout` (issue #5939). The two edges
     * alone read calm while a 20-minute `test` step's middle did not.
     *
     * A beat reads the whole machine, so it also counts the step's own
     * workers, and other holders' load while the step queues on the heavy
     * mutex. That may excuse a first timeout-only failure the tree caused;
     * `repeatedMachineTimeout` bounds the excuse to once per step.
     */
    samples?: MachineSample[];
}

const PREFIX = "health-main:";
export const DEFAULT_LIVENESS_MS = 60_000;

/**
 * The full gate, in series, stopping at the first red — the name of the
 * failing entry is what the RED verdict records as `failedStep`.
 *
 * `check:ui --all` (the full browser walk, issue #4913) is the one step that
 * is not offline: it needs the local deployment and a browser, which is why
 * it is not in `check:all` (`docs/agents/quality-gates.md` § check:ui). It is
 * LAST, after every offline verdict, and it is the backstop for what a PR's
 * SCOPED receipt accepts not to see (ADR 0131 amendment): a PR walks the
 * surfaces its diff can reach, `release` (`--ui-all`) walks them all — a
 * batch run owes no walk (issue #5378). It takes the
 * machine-wide `check:ui` lane (`ui-admission.ts`), a separate mutex from the
 * heavy gate's, so a PR's own run and this one never overlap on the backend.
 *
 * The walk runs OUTSIDE the heavy-mutex hold (issue #4962): a gate that holds
 * the mutex for the offline gates (`health-main --phase=offline`) releases it
 * and walks afterwards (`--phase=walk`) under the `check:ui` lane alone — a 12–60 min browser walk needs no suite's CPU budget, and every
 * queued `land` used to wait it out. `splitHealthGates` is that cut. The
 * verdict is still ONE record per tip: offline green + walk green = GREEN.
 * A walk the environment cut short is `infra` (`lib/health-verdict.ts`); one
 * the tree failed is RED.
 *
 * THE RULE IS COST, NOT PHASE (issue #4963): a guard whose measured cost is
 * ≤ 10 s on the heavy tier belongs in the lane (`check:lane`, paid once by
 * `land`); health-only is for guards that cost more, and each one is named in
 * `HEALTH_ONLY_GUARDS` below with its measured cost. A new guard states its
 * measured cost in its PR. The rule it replaced — "a new guard goes on
 * `health`, never on a PR-phase gate" (issue #4490) — protected PRs from
 * COST, and applied to guards that cost nothing it only moved their failure
 * to the most expensive place: 19 of 40 RED tips in 14 days were violations
 * a 3-second check would have refused at `land`.
 *
 * `check:gaps`, `check:targets` and `check:test-hygiene` are the script
 * cheap guards (`CHEAP_GUARDS` in `check-lane.ts`, with their measured costs
 * and admission paths). They run in the lane on every diff that can move them
 * AND stay here, because health is the full gate — the lane is only where a
 * violation is first seen. The fourth row, `blade-index` (issue #5940), is a
 * bot-node vitest file, not a script: health runs it in the `test` step
 * (`test:bot`), never as an entry of this list. Here they run AFTER `check:all`, which holds
 * `check:oracle`: an un-regenerated lockfile is lockfile DRIFT, and that is
 * the error a reader must see, not a census computed off a stale file.
 * `check:targets` reads the same lockfile and allowlist as `check:gaps`, and
 * follows it.
 *
 * Exported so `check-gaps.test.ts` can assert the membership rather than
 * re-derive it from a regex over `health-main.ts` (which carries the gate's
 * zero-import constraint and cannot be imported by a test — it runs `main()`
 * on load).
 */
export const HEALTH_SCRIPTS: readonly string[] = [
    "worktree:init",
    "check:all",
    "check:gaps",
    "check:targets",
    "check:test-hygiene",
    "test",
    "check:ui --all",
    "check:game-download",
];

/**
 * The guards no SCOPED lane (`engine`, `skin`, `cards`, `docs`) runs, each
 * with its MEASURED cost — the only legal reason to keep a guard out of
 * `check:lane` (issue #4963: ≤ 10 s on the heavy tier belongs in the lane;
 * ADR 0154 §3). The `full` lane is `check:pr` verbatim and may still compose
 * one of them. `check-lane.test.ts`'s census reds on a `check:*` package
 * script that is in neither a lane plan nor this list, and on an entry here
 * whose measured cost is within the lane budget or that a scoped lane runs.
 *
 * `check:lane` itself is not a guard but the lane's runner, and is the one
 * name the census exempts.
 */
export const LANE_COST_BUDGET_S = 10;

export const HEALTH_ONLY_GUARDS: Readonly<
    Record<string, { measuredCostS: number; measured: string }>
> = {
    // The full browser walk (issue #4913). A PR pays its own SCOPED run by
    // hand and pastes the receipt (`chrome-debug.md`); the lane cannot,
    // because it needs a deployment and a browser and `check:lane` is offline.
    "check:ui": {
        measuredCostS: 879,
        measured:
            "`check:ui --all` in health: 14m39s green, 45m37s red (detach.log, 2026-10)",
    },
    // A game's card-data download on a production build (issue #5618): a
    // `vite build`, then a Solo and a Bot game in Chromium against the
    // deployment — a browser step of the walk phase (`isWalkStep`), offline
    // `check:lane` cannot run it. The walk phase runs on `release` (and
    // `--ui-all`), never in batch health (`planHealthWalk`): a regression
    // waits on the base for the next release.
    "check:game-download": {
        measuredCostS: 30,
        measured:
            "`bun run check:game-download` 28 s / 30 s at load ~2 (2026-10-18; build 12 s, two games)",
    },
    // The client bundle build (ADR 0154 §3, issue #5464): a full `vite build`
    // every lane paid for the duplicate-import class, now health's
    // `check:all`. `check:convex-bundle` is NOT here — 2 s, it rides the lane.
    "check:bundle": {
        measuredCostS: 24,
        measured:
            "`bun run check:bundle` 24 s at load ~10 (2026-10-12); 12.2/12.4/12.5/20.7 s in land logs land-4954/-4983/-5170/-4775",
    },
    // The bot fast lane (ADR 0154 §3, issue #5464): `TOLARIA_BOT_FAST=1` over
    // `bot-node` + `bot-dom` — `test:bot` with `HEAVY_BOT_GLOB` empty since
    // issue #2436. Its byte-identity pins (mana census, forced-pass pins) were
    // 29 of 34 vitest reds at `land` in 14 days, all base drift. Health runs
    // it as `test` → `test:bot`; the `full` lane still runs it inside
    // `check:pr` → `check:guards`.
    "test:bot": {
        measuredCostS: 100,
        measured:
            "bot fast lane in land logs: 99.6/100.1/107.8/176.2 s (land-4954/-4983/-5170/-4775, 2026-10)",
    },
};

/**
 * The third tier: `check:*` scripts that are NEVER GATED (issue #5458) — a
 * diagnostic report whose verdict no tip waits for. `bun run maintenance`
 * runs them by hand (`scripts/maintenance.ts`) and prints each report; no
 * lane, no health run and no `release` composes them. `check-lane.test.ts`'s
 * census accepts a `check:*` script here as placed, and reds on one that is
 * also in a lane or in `HEALTH_ONLY_GUARDS`.
 *
 * Membership is a JUDGMENT, not a cost: the report measures a capacity the
 * tree is not yet asked to hold, so a red one is a planning input, not a
 * broken tip. A guard that protects the tree as it is belongs in a lane or in
 * health, whatever it costs.
 */
export const MAINTENANCE_SCRIPTS: Readonly<
    Record<string, { measuredCostS: number; measured: string; why: string }>
> = {
    // The heap of one call per isolate module, today and at 35k cards (issue
    // #4853), armed by issue #4862: ~480 bundles + node probes, exit 1 on a
    // module over budget at TARGET scale, the client catalogue included. It
    // was 9–17 min of every health run (issue #5458).
    "check:convex-heap": {
        measuredCostS: 753,
        measured:
            "`bun run check:convex-heap` full walk, 478 modules: 753 s, load ~2-4 (2026-10-04)",
        why: "a 35k-card capacity analysis: over budget at target scale is a plan, not a red tip",
    },
};

/** The `bun run` argv for one `HEALTH_SCRIPTS` entry: the script name, then
 *  the flags the entry carries after it (`check:ui --all`). */
export function healthStepArgs(entry: string): string[] {
    return ["run", ...entry.split(/\s+/)];
}

/** The browser walk's own steps: a fresh worktree needs its bootstrap first. */
export const WALK_BOOTSTRAP = "worktree:init";

/**
 * One run's gates cut in two (issue #4962): `offline` — everything that is not
 * the browser walk, in order, the Bot gates included — and `walk`, the
 * `check:ui` entries, which run after the heavy mutex is released.
 */
export function splitHealthGates(gates: readonly string[]): {
    offline: string[];
    walk: string[];
} {
    return {
        offline: gates.filter((g) => !isWalkStep(g)),
        walk: gates.filter((g) => isWalkStep(g)),
    };
}

/**
 * The environment every health step runs under. The health gate must queue on
 * the machine mutex like any other heavy gate — so the hold `land`'s locked
 * shell exported is scrubbed — and it must prove every pure drift guard from
 * scratch rather than trust a cached PASS recorded by some earlier run
 * (issue #3646): that is what makes `release` the full gate. The literal is
 * `GUARD_CACHE_BYPASS_ENV` in `guard-cache.ts`, restated because this module
 * imports builtins only; `guard-cache.test.ts` pins the two together.
 *
 * `keepHold` is the one exception, and it exists for the per-batch gate (ADR
 * 0136 §6, issue #3780): there the WHOLE run is wrapped in one `gate.ts yield`
 * acquisition, so the three steps must pass THROUGH that hold instead of
 * queuing behind it three times. Scrubbing the hold there would break the
 * property the yield rule is built on — health takes the mutex once, for one
 * uninterrupted block, and every queued land waits exactly that block rather
 * than racing into two gaps. `release` does not pass it and is unchanged.
 */
export function healthGateEnv(
    parent: NodeJS.ProcessEnv,
    opts: { keepHold?: boolean } = {}
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent, TOLARIA_GUARD_CACHE: "off" };
    if (!opts.keepHold) {
        delete env.TOLARIA_GATE_HELD;
        delete env.TOLARIA_ALLOW_FULL_SUITE;
    }
    return env;
}

/** `4m12s`, `37s`, `1h02m` — same shape as `gate.ts`'s holder lines. */
export function fmtElapsed(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** The lines a child prints that the terminal must see while it runs. */
export function isGateLine(line: string): boolean {
    return line.startsWith("[gate]");
}

/**
 * Splits a byte stream into complete lines, forwarding the `[gate]` ones.
 * A line split across two chunks is held until its newline arrives.
 */
function gateLineForwarder(out: (line: string) => void) {
    let pending = "";
    return {
        push(chunk: string) {
            pending += chunk;
            let nl = pending.indexOf("\n");
            while (nl !== -1) {
                const line = pending.slice(0, nl).replace(/\r$/, "");
                pending = pending.slice(nl + 1);
                if (isGateLine(line)) out(`${line}\n`);
                nl = pending.indexOf("\n");
            }
        },
        flush() {
            if (isGateLine(pending)) out(`${pending}\n`);
            pending = "";
        },
    };
}

export function runHealthStep(
    step: HealthStep,
    opts: StepRunOptions
): Promise<StepResult> {
    const out = opts.out ?? ((line: string) => process.stdout.write(line));
    const livenessMs = opts.livenessMs ?? DEFAULT_LIVENESS_MS;
    const tag = `${PREFIX} [${step.ordinal}/${step.total}] ${step.name}`;
    const t0 = Date.now();

    out(`${tag} — start\n`);

    const sample = opts.sample ?? (() => readMachineSample());
    const samples: MachineSample[] = [];
    const readMachine = (): void => {
        // A probe that fails costs the reading, never the step.
        try {
            samples.push(sample());
        } catch {
            /* no sample this time */
        }
    };
    readMachine();

    return new Promise((resolvePromise) => {
        const child = spawn(step.cmd, step.args, {
            cwd: opts.cwd,
            env: step.env ? { ...opts.env, ...step.env } : opts.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const fromOut = gateLineForwarder(out);
        const fromErr = gateLineForwarder(out);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (c: string) => {
            stdout += c;
            fromOut.push(c);
        });
        child.stderr.on("data", (c: string) => {
            stderr += c;
            fromErr.push(c);
        });

        const liveness = setInterval(() => {
            out(
                `${tag} — still running, ${fmtElapsed(Date.now() - t0)} elapsed\n`
            );
            readMachine();
        }, livenessMs);

        let settled = false;
        const finish = (
            status: number | null,
            signal: NodeJS.Signals | null
        ) => {
            if (settled) return;
            settled = true;
            clearInterval(liveness);
            readMachine();
            fromOut.flush();
            fromErr.flush();
            // Byte-identical to the spawnSync capture this replaced: header,
            // then the whole stdout, then the whole stderr.
            appendFileSync(
                opts.logPath,
                `\n===== ${step.cmd} ${step.args.join(" ")} (exit ${status}) =====\n${stdout}${stderr}`
            );
            const elapsedMs = Date.now() - t0;
            const how =
                status !== null
                    ? `exit ${status}`
                    : signal
                      ? `killed by ${signal}`
                      : "no exit code (spawn failure)";
            out(`${tag} — ${how} after ${fmtElapsed(elapsedMs)}\n`);
            resolvePromise({
                ok: status === 0,
                status,
                signal,
                elapsedMs,
                output: `${stdout}${stderr}`,
                samples,
            });
        };
        // `close`, not `exit`: it fires after both pipes have drained, so the
        // log never loses a tail the child wrote just before exiting.
        child.on("close", (code, signal) => finish(code, signal));
        child.on("error", (err) => {
            stderr += `${err.message}\n`;
            finish(null, null);
        });
    });
}
