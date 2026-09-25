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
 * Node builtins only — `health-main.ts` carries the same constraint.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

export interface HealthStep {
    /** 1-based position in the run, and the run's step count. */
    ordinal: number;
    total: number;
    /** What the terminal lines and the RED verdict call this step. */
    name: string;
    cmd: string;
    args: string[];
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
}

const PREFIX = "health-main:";
export const DEFAULT_LIVENESS_MS = 60_000;

/**
 * The full offline gate, in series, stopping at the first red — the name of
 * the failing entry is what the RED verdict records as `failedStep`.
 *
 * `check:targets` (the Coverage Invariant, issue #3868) lives here on the
 * same terms and after `check:gaps`: it reads the same lockfile and allowlist.
 *
 * `check:test-hygiene` (the test-suite hygiene census, issue #4490) lives here
 * too: it keeps the identity-test classifier's two purge classes at zero
 * across every test file, and its Op-only half loads the whole catalogue —
 * a cost no PR diff should pay, and a verdict a new constant-pin test can only
 * change by being written (issue #4490: a new guard goes on `health`, never
 * on a PR-phase gate).
 *
 * `check:gaps` (the derived Op census, ADR 0105 § 7.3) lives HERE and nowhere
 * else: it is a census over the committed lockfile, so a PR gate would pay for
 * it on every diff that cannot move it. It runs AFTER `check:all`, because
 * `check:all` holds `check:oracle` — an un-regenerated lockfile is lockfile
 * DRIFT, and that is the error a reader must see, not a census computed off a
 * stale file.
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
];

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
            env: opts.env,
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
            resolvePromise({ ok: status === 0, status, signal, elapsedMs });
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
