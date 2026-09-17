#!/usr/bin/env bun
/**
 * The per-batch health gate's driver (ADR 0136 §6, issue #3780).
 *
 * `land` pays the LANE gate, on the rebased tip, inside the mutex. The FULL
 * gate — `health-main.ts` — runs per BATCH of landings instead of per release
 * (ADR 0116) or per landing (ADR 0110): after the 5th landing since the last
 * GREEN, or 2 h after the first un-healthed one, whichever comes first.
 *
 * Three subcommands; `land`'s locked command calls the first two, and both are
 * non-gating there (a merged PR never fails on health bookkeeping):
 *
 *   record --sha=<tip>   append the landing to the ledger. Synchronous and
 *                        tiny: it must be durable before the next `land` can
 *                        take the mutex and read it.
 *   spawn                re-launch THIS script's `detach` in its own session
 *                        and exit at once. Synchronous, ~60 ms.
 *   detach               decide, and on a FIRE run the gate. Never invoked
 *                        directly by `land`.
 *
 * WHY `spawn` EXISTS, AND WHY `nohup … &` IS NOT ENOUGH. `gate.ts` runs its
 * wrapped command `detached`, so the `sh` it spawns leads its own process
 * GROUP, and every teardown path — the ordinary `exit` handler after a clean
 * child exit included — signals that whole group (`killChildTree`, issue
 * #3821). `nohup` sets SIGHUP to ignored and redirects output; it does not
 * leave the process group, and neither does `&`. So a health run backgrounded
 * from inside `land`'s locked shell is a member of the group `land` SIGKILLs
 * on its way out, milliseconds later — measured: the marker file a backgrounded
 * `sleep 4` should have written never appeared. The batch gate would have
 * looked installed and done nothing, for ever, silently.
 *
 * `spawn` escapes it the only portable way: node's `spawn(…, { detached: true })`
 * calls `setsid(2)`, so the child leads a new SESSION that no group signal to
 * `land`'s tree can reach. It also closes stdin (`stdio: "ignore"`), which
 * `nohup` does not — an inherited controlling terminal is what would let the
 * RED handover below spawn an interactive fixer into the user's foreground
 * session and hang on SIGTTIN.
 *
 * The decision itself is `lib/health-cadence.ts`, pure and tested there; this
 * file is the fetch, the ledger file, the gate spawn and the RED handover.
 *
 * WHY THE GATE RUNS UNDER `gate.ts yield`. The full gate holds the machine
 * mutex ~10 min and a `land` ~4. A health run that grabbed the mutex the
 * moment it came free would put every queued landing behind ten minutes of
 * full gate for nothing: the tip health is about does not get staler while a
 * land runs — the land only adds a commit the NEXT health run covers anyway.
 * So the whole run goes through ONE `yield` acquisition (lands first, bounded
 * so health cannot starve) and `health-main --under-lock` passes its three
 * steps through that single hold rather than queuing three times. The
 * scenarios: `docs/guides/next-issue-flow.md` § 2 A/B/C.
 *
 * RED reuses `health-fix.ts` unchanged: `health-main` has already written the
 * durable marker and `last.json`, so the handover is the same one `release`
 * makes. Detached, there is no TTY, so `health:fix` refuses with its own line
 * and the marker stands — which is the load-bearing half anyway, because the
 * marker is what makes `queue:plan` refuse the next PICK.
 */
import { spawn, spawnSync } from "node:child_process";
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import {
    afterFire,
    healthRunInFlight,
    healthTrigger,
    parseCadence,
    recordLanding,
    reconcileHealthRun,
    serializeCadence,
    type CadenceState,
    type HealthRecord,
} from "./lib/health-cadence";
import { HEALTH_ROLE } from "./lib/gate-liveness";
import { primaryCheckout } from "./lib/primary-checkout";

const SELF = resolve(__dirname, "health-cadence.ts");
const HEALTH_MAIN = resolve(__dirname, "health-main.ts");
const HEALTH_FIX = resolve(__dirname, "health-fix.ts");
const GATE = resolve(__dirname, "gate.ts");

/** Health telemetry directory, relative to the primary checkout — the same
 *  one `health-main.ts` and `health-fix.ts` write. */
export const HEALTH_DIR = join(".claude", "telemetry", "health");
/** The ledger, beside `last.json` and the `RED` marker. */
export const CADENCE_FILE = "cadence.json";

export function cadencePath(root: string): string {
    return join(root, HEALTH_DIR, CADENCE_FILE);
}

function readCadence(root: string): CadenceState {
    const p = cadencePath(root);
    try {
        return parseCadence(existsSync(p) ? readFileSync(p, "utf8") : null);
    } catch {
        return parseCadence(null);
    }
}

/**
 * Atomic: write a temp file, then rename over the ledger.
 *
 * A bare `writeFileSync` truncates first, and `parseCadence` reads any parse
 * failure — an empty file included — as EMPTY. The `record` inside `land`'s
 * mutex and this script's own writes are genuinely concurrent (the mutex
 * serialises LANDINGS, not the detached run), so a reader landing in the
 * zero-length window would silently reset `lastGreenSha` and the counter.
 * `rename` is atomic on APFS, so a reader sees one whole version or the other.
 */
function writeCadence(root: string, state: CadenceState): void {
    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${CADENCE_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, serializeCadence(state));
    renameSync(tmp, cadencePath(root));
}

function readLast(root: string): HealthRecord | null {
    try {
        return JSON.parse(
            readFileSync(join(root, HEALTH_DIR, "last.json"), "utf8")
        ) as HealthRecord;
    } catch {
        return null;
    }
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function flag(name: string): string | null {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.slice(name.length + 3) : null;
}

function record(root: string): number {
    const sha = flag("sha");
    if (sha === null || !/^[0-9a-f]{40}$/.test(sha)) {
        console.error(
            `health-cadence: record needs --sha=<40-hex tip>, got ${JSON.stringify(sha)}`
        );
        return 2;
    }
    const state = recordLanding(readCadence(root), sha, Date.now());
    writeCadence(root, state);
    console.log(
        `health-cadence: ${state.landings.length} landing(s) since the last GREEN (latest ${sha.slice(0, 8)})`
    );
    return 0;
}

/**
 * Re-launch `detach` in its own SESSION, then exit. See the WHY at the top:
 * anything merely backgrounded from `land`'s locked shell is inside the
 * process group `land` SIGKILLs on its way out.
 */
function spawnDetached(root: string): number {
    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, "detach.log");
    const env = { ...process.env };
    // The hold `land`'s locked shell exported is released the instant that
    // shell exits; a health run that inherited it would compute `nested` in
    // `gate.ts`, acquire NOTHING, start no heartbeat — and still run the full
    // suites, with no mutex, beside whoever actually holds it.
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    // Recomputed by the gate this run takes for itself, never inherited from
    // the one that is ending.
    delete env.TOLARIA_VITEST_WORKERS;
    delete env.TOLARIA_GATE_ROLE;

    const branch = flag("branch");
    // Test-only, same convention as `gate.ts`'s TOLARIA_GATE_* overrides: what
    // the suite has to prove is that the child SURVIVES `land`'s process-group
    // kill, and a real decision would start by fetching from origin.
    const override = process.env.TOLARIA_HEALTH_DETACH_CMD;
    const cmd = override === undefined ? "bun" : "sh";
    const args =
        override === undefined
            ? [
                  SELF,
                  "detach",
                  ...(branch === null ? [] : [`--branch=${branch}`]),
              ]
            : ["-c", override];
    const log = openSync(logPath, "a");
    try {
        const child = spawn(cmd, args, {
            cwd: root,
            env,
            detached: true,
            // stdin CLOSED, not inherited: `nohup` redirects stdout and
            // stderr only, and an inherited controlling terminal would let
            // the RED handover spawn an interactive fixer into the user's
            // foreground session — SIGTTIN, or stolen keystrokes.
            stdio: ["ignore", log, log],
        });
        child.unref();
        console.log(`health-cadence: detached decision as pid ${child.pid}`);
    } finally {
        closeSync(log);
    }
    return 0;
}

function detach(root: string): number {
    const branch = flag("branch") ?? BASE_BRANCH;
    git(["fetch", "origin", branch, "-q"], root);
    const tip = git(["rev-parse", `origin/${branch}`], root);

    // One run at a time, whatever sha it is about — see `healthRunInFlight`.
    const inFlight = healthRunInFlight(readLast(root), Date.now());
    if (inFlight !== null) {
        console.log(`health-cadence: holding — ${inFlight}`);
        return 0;
    }

    const state = readCadence(root);
    const firedAt = Date.now();
    const verdict = healthTrigger({ state, tip, now: firedAt });
    if (verdict.kind === "hold") {
        console.log(`health-cadence: holding — ${verdict.reason}`);
        return 0;
    }

    console.log(
        `health-cadence: firing on ${verdict.trigger} — ${verdict.reason}; gating ${tip.slice(0, 8)}`
    );
    // The dedup stamp goes in BEFORE the gate, not after: a second landing
    // during the run detaches a second decision, and the stamp is what makes
    // that one hold instead of racing `health-main`'s own running-record.
    writeCadence(root, afterFire(state, tip, firedAt));

    // ONE acquisition for the whole run — see the WHY at the top.
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        TOLARIA_GATE_ROLE: HEALTH_ROLE,
    };
    // Defence in depth: `land` already scrubs the hold before spawning this
    // process, but a `gate.ts yield` that finds `TOLARIA_GATE_HELD` set is a
    // no-op acquisition that still runs the full suites (`nested` in
    // `gate.ts`), off the mutex and with no heartbeat.
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    const r = spawnSync(
        "bun",
        [
            GATE,
            "yield",
            `bun ${JSON.stringify(HEALTH_MAIN)} --branch=${branch} --under-lock`,
        ],
        { stdio: "inherit", cwd: root, env }
    );

    // The RECORD is the verdict, never the exit status, and never the sha this
    // run SNAPSHOTTED: `health-main` re-resolves the tip when it finally gets
    // the mutex, which after yielding to queued lands is routinely a later
    // commit. `reconcileHealthRun` owns that — see its header for what an
    // equality check against `tip` would silently cost.
    const action = reconcileHealthRun(readCadence(root), {
        last: readLast(root),
        firedAt,
    });
    if (action.kind === "none") {
        console.error(
            `health-cadence: ${action.reason} (gate exited ${r.status ?? "on a signal"}) — the ledger is left as it is`
        );
        return 1;
    }
    writeCadence(root, action.state);
    if (action.kind === "green") {
        console.log(`health-cadence: ${action.reason}`);
        return 0;
    }
    // RED. `health-main` has already written the marker and `last.json`; the
    // handover is `release`'s, unchanged. The counter is deliberately NOT
    // reset: the next landing is on a new tip, so it fires again — which is
    // how the fix-forward gets gated at once instead of waiting out a batch.
    console.error(
        `health-cadence: ${action.reason} — handing over to health:fix`
    );
    spawnSync("bun", [HEALTH_FIX], { stdio: "inherit", cwd: root });
    return 1;
}

function status(root: string): number {
    const state = readCadence(root);
    console.log(`health-cadence — ${root}`);
    console.log(
        `  last GREEN: ${state.lastGreenSha?.slice(0, 8) ?? "none recorded"}`
    );
    console.log(
        `  last fired: ${state.lastFiredSha?.slice(0, 8) ?? "none recorded"}${state.lastFiredAt ? ` @ ${new Date(state.lastFiredAt).toISOString()}` : ""}`
    );
    console.log(`  un-healthed landings: ${state.landings.length}`);
    for (const l of state.landings)
        console.log(
            `    · ${l.sha.slice(0, 8)} @ ${new Date(l.at).toISOString()}`
        );
    return 0;
}

function main(): void {
    const root = primaryCheckout(process.cwd());
    const [, , sub] = process.argv;
    switch (sub) {
        case "record":
            process.exit(record(root));
            break;
        case "spawn":
            process.exit(spawnDetached(root));
            break;
        case "detach":
            process.exit(detach(root));
            break;
        case "status":
            process.exit(status(root));
            break;
        default:
            console.error(
                "usage: bun scripts/health-cadence.ts <record --sha=<tip>|spawn [--branch=<name>]|detach [--branch=<name>]|status>"
            );
            process.exit(2);
    }
}

if (import.meta.main) {
    main();
}
