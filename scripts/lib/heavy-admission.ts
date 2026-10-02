/**
 * Re-exec a script under the heavy gate's `job` tier (issue #4941).
 *
 * WHY. Most heavy work is admitted in `package.json` — the script's command is
 * `bun scripts/gate.ts <tier> '<command>'`. That spelling cannot express "only
 * on SOME flags": `oracle:compile` plays the Bot-play sweep (mean 28 min) when
 * bare, but `--check` and `--carry-bot` never play, and `--carry-bot` is what
 * `land`'s artifact resolver runs. Wrapping the whole script would queue the
 * drift guard behind a `land` for nothing. So a script whose cost depends on
 * its flags decides in-process and, when it is the heavy spelling, re-runs
 * itself under `gate.ts job` — the outer process does nothing but wait.
 *
 * NESTED. Under a hold the gate already exports `TOLARIA_GATE_HELD=1` (`land`,
 * `health-main --under-lock`, any heavy `bun run`): the decision is then "run
 * here", never a second acquisition — the mutex is not re-entrant, and asking
 * for it again from inside the hold would wait on itself forever.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const GATE = resolve(import.meta.dir, "..", "gate.ts");

/** POSIX single-quote one word, so `sh -c` sees it as exactly that word. */
function shellQuote(word: string): string {
    return /^[\w@%+=:,./-]+$/.test(word)
        ? word
        : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `bun` argv that runs `script args…` under the `job` tier, or null when
 * the caller already runs under a hold and must run in place. Pure.
 */
export function heavyAdmissionArgv(
    script: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv
): string[] | null {
    if (env.TOLARIA_GATE_HELD === "1") return null;
    return [GATE, "job", ["bun", script, ...args].map(shellQuote).join(" ")];
}

/**
 * Run `script args…` under the `job` tier and resolve with its exit code — or
 * resolve null at once when already under a hold (run in place).
 *
 * The gate is spawned async so this process can forward a targeted signal:
 * `gate.ts` reaps its own detached child group on SIGINT / SIGTERM / SIGHUP
 * (issue #3821), but only if the signal reaches it, and a SIGTERM aimed at
 * THIS pid would otherwise leave the gate — and the sweep under it — running.
 */
export function runUnderHeavyAdmission(
    script: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv = process.env
): Promise<number | null> {
    const argv = heavyAdmissionArgv(script, args, env);
    if (!argv) return Promise.resolve(null);
    const child = spawn("bun", argv, { stdio: "inherit", env });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => child.kill(sig));
    }
    return new Promise((done) => {
        child.on("exit", (code, signal) => done(signal ? 128 : (code ?? 1)));
    });
}
