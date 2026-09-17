#!/usr/bin/env bun
/**
 * The per-batch health gate's driver (ADR 0136 §6, issue #3780).
 *
 * `land` pays the LANE gate, on the rebased tip, inside the mutex. The FULL
 * gate — `health-main.ts` — runs per BATCH of landings instead of per release
 * (ADR 0116) or per landing (ADR 0110): after the 5th landing since the last
 * GREEN, or 2 h after the first un-healthed one, whichever comes first.
 *
 * Two subcommands, both called by `land`'s locked command, both non-gating
 * there (a merged PR never fails on health bookkeeping):
 *
 *   record --sha=<tip>   append the landing to the ledger. Synchronous and
 *                        tiny: it must be durable before the next `land` can
 *                        take the mutex and read it.
 *   detach               decide, and on a FIRE run the gate. Detached by the
 *                        caller (`nohup … &`), so the session that triggered
 *                        it is not the session that waits for it.
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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import {
    afterFire,
    afterGreen,
    healthTrigger,
    parseCadence,
    recordLanding,
    serializeCadence,
    type CadenceState,
} from "./lib/health-cadence";
import { HEALTH_ROLE } from "./lib/gate-liveness";
import { primaryCheckout } from "./lib/primary-checkout";

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

function writeCadence(root: string, state: CadenceState): void {
    const p = cadencePath(root);
    mkdirSync(join(root, HEALTH_DIR), { recursive: true });
    writeFileSync(p, serializeCadence(state));
}

interface LastRun {
    sha: string;
    status: "running" | "green" | "red";
    startedAt: string;
    failedStep?: string;
}

function readLast(root: string): LastRun | null {
    try {
        return JSON.parse(
            readFileSync(join(root, HEALTH_DIR, "last.json"), "utf8")
        ) as LastRun;
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

function detach(root: string): number {
    const branch = flag("branch") ?? BASE_BRANCH;
    git(["fetch", "origin", branch, "-q"], root);
    const tip = git(["rev-parse", `origin/${branch}`], root);

    const state = readCadence(root);
    const verdict = healthTrigger({ state, tip, now: Date.now() });
    if (verdict.kind === "hold") {
        console.log(`health-cadence: holding — ${verdict.reason}`);
        return 0;
    }

    console.log(
        `health-cadence: firing on ${verdict.trigger} — ${verdict.reason}; gating ${tip.slice(0, 8)}`
    );
    // The dedup stamp goes in BEFORE the gate, not after: a second landing
    // during the run detaches a second `detach`, and the stamp is what makes
    // that one hold instead of racing `health-main`'s own running-record.
    writeCadence(root, afterFire(state, tip));

    // ONE acquisition for the whole run — see the WHY at the top.
    const r = spawnSync(
        "bun",
        [
            GATE,
            "yield",
            `bun ${JSON.stringify(HEALTH_MAIN)} --branch=${branch} --under-lock`,
        ],
        {
            stdio: "inherit",
            cwd: root,
            env: { ...process.env, TOLARIA_GATE_ROLE: HEALTH_ROLE },
        }
    );

    // The RECORD is the verdict, never the exit status: `health-main` also
    // exits 0 when it short-circuits on a sha another run already has.
    const last = readLast(root);
    if (last === null || last.sha !== tip) {
        console.error(
            `health-cadence: no health record about ${tip.slice(0, 8)} (gate exited ${r.status ?? "on a signal"}) — the ledger is left as it is`
        );
        return 1;
    }
    if (last.status === "green") {
        writeCadence(
            root,
            afterGreen(readCadence(root), tip, Date.parse(last.startedAt))
        );
        console.log(`health-cadence: GREEN @ ${tip.slice(0, 8)} — batch reset`);
        return 0;
    }
    if (last.status === "running") {
        console.log(
            `health-cadence: ${tip.slice(0, 8)} is being gated elsewhere — nothing to record`
        );
        return 0;
    }
    // RED. `health-main` has already written the marker and `last.json`; the
    // handover is `release`'s, unchanged. The counter is deliberately NOT
    // reset: the next landing is on a new tip, so it fires again — which is
    // how the fix-forward gets gated at once instead of waiting out a batch.
    console.error(
        `health-cadence: RED @ ${tip.slice(0, 8)}${last.failedStep ? ` (${last.failedStep})` : ""} — handing over to health:fix`
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
        `  last fired: ${state.lastFiredSha?.slice(0, 8) ?? "none recorded"}`
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
        case "detach":
            process.exit(detach(root));
            break;
        case "status":
            process.exit(status(root));
            break;
        default:
            console.error(
                "usage: bun scripts/health-cadence.ts <record --sha=<tip>|detach [--branch=<name>]|status>"
            );
            process.exit(2);
    }
}

if (import.meta.main) {
    main();
}
