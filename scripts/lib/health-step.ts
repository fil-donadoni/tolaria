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
 *   - a liveness line every `livenessMs` while the step runs,
 *   - an END line with the exit status and the wall-clock elapsed.
 *
 * Plain appended lines, no TTY tricks, so the output stays greppable.
 *
 * Node builtins plus `lib/health-verdict.ts` (builtins and builtins-only
 * modules only) — `health-main.ts` carries the same constraint.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isWalkStep } from "./health-verdict";

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
 * surfaces its diff can reach, the batch walks them all. It takes the
 * machine-wide `check:ui` lane (`ui-admission.ts`), a separate mutex from the
 * heavy gate's, so a PR's own run and this one never overlap on the backend.
 *
 * The walk runs OUTSIDE the heavy-mutex hold (issue #4962): the per-batch gate
 * takes the mutex for the offline gates only (`health-main --phase=offline`),
 * releases it, and walks afterwards (`--phase=walk`) under the `check:ui` lane
 * alone — a 12–60 min browser walk needs no suite's CPU budget, and every
 * queued `land` used to wait it out. `splitHealthGates` is that cut. The
 * verdict is still ONE record per tip: offline green + walk green = GREEN.
 * A walk the environment cut short is `infra`, and a walk still in probation
 * raises no RED marker (`lib/health-verdict.ts`).
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
 * `check:gaps`, `check:targets` and `check:test-hygiene` are those cheap
 * guards (`CHEAP_GUARDS` in `check-lane.ts`, with their measured costs and
 * admission paths). They run in the lane on every diff that can move them
 * AND stay here, because health is the full gate — the lane is only where a
 * violation is first seen. Here they run AFTER `check:all`, which holds
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
    "check:convex-heap",
    "test",
    "check:ui --all",
];

/**
 * The `check:*` guards that run in NO lane, each with its MEASURED cost — the
 * only legal reason to keep a guard out of `check:lane` (issue #4963: ≤ 10 s
 * on the heavy tier belongs in the lane). `check-lane.test.ts`'s census reds
 * on a `check:*` package script that is in neither a lane plan nor this list,
 * and on an entry here whose measured cost is within the lane budget.
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
    // The heap of one call per isolate module, today and at 35k cards (issue
    // #4853): ~480 bundles + node probes, a report with WARN lines, exit 0.
    "check:convex-heap": {
        measuredCostS: 753,
        measured:
            "`bun run check:convex-heap` full walk, 478 modules: 753 s, load ~2-4 (2026-10-04)",
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
        }, livenessMs);

        let settled = false;
        const finish = (
            status: number | null,
            signal: NodeJS.Signals | null
        ) => {
            if (settled) return;
            settled = true;
            clearInterval(liveness);
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
