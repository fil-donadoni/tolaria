#!/usr/bin/env bun
// Process leases (issue #5470) — every process tree the tooling spawns says
// who owns it, until when, and from where, so an ACTIVE reaper
// (`scripts/reaper.ts`) can terminate the trees nobody owns any more.
//
// Before this, the reaping was passive: `gate-run.sh` reaped a run's group only
// when somebody invoked it, `gate.ts` reclaimed a holder that stopped burning
// CPU, and vitest workers, Chromium, Vite, `convex-local-backend` and
// `claude -p` passes had no owner at all once their session or worktree was
// gone. The phantom pids that saturated the CPU went unnoticed because
// nothing was looking.
//
// TWO halves, one record:
//
//   * the LEASE — a JSON file per tree under the cache dir: the anchor pid
//     (and its start second, so a recycled pid is not mistaken for it), the
//     cwd, the parent lease, a deadline, and an optional grace window a
//     legitimate re-attach opens;
//   * the TAG — `TOLARIA_OWNER=<lease id>` in the environment of everything
//     the anchor spawns. A process inherits it through any number of forks
//     and execs and keeps it after its parent dies, which is exactly the
//     orphan the process tree loses (an orphan is re-parented to pid 1).
//     The reaper reads it from `/proc/<pid>/environ` (Linux) or `ps -E`
//     (macOS, same uid) — whatever the binary is.
//
// A lease is ALIVE while its anchor runs, its deadline is ahead, and its cwd
// exists (unless the spawner deletes its own cwd by design: `land`,
// `docs:ship`) — and its parent lease, if it named one, is alive. Everything
// tagged with a dead lease is reaped (`scripts/reaper.ts`).
//
// The shell spawners (`gate-run.sh`, `loop-drain.sh`) use the CLI at the
// bottom; the TS ones call `holdLease`. ONE writer of the format.

import {
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
    appendFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** The environment variable every spawned process inherits. */
export const OWNER_ENV = "TOLARIA_OWNER";

/**
 * An owner tag with this prefix belongs to a SERVICE MANAGER (a launchd job,
 * a systemd unit): its lifecycle is the unit's, which kills its own tree
 * (`KillMode=control-group`). The reaper never reaps on such a tag, and a
 * process carrying one is never an untagged stray either.
 */
export const UNIT_OWNER_PREFIX = "unit:";

export interface ProcessLease {
    /** The tag value — `[A-Za-z0-9._:-]`, unique per tree. */
    id: string;
    /** Which spawner: `gate-run`, `gate`, `check:ui`, `health-main`, `loop-pass`. */
    kind: string;
    /** The anchor: the process whose life the lease follows. */
    pid: number;
    /** The anchor's start, epoch SECONDS — a recycled pid has another. `0` =
     *  unknown (the pid alone is trusted). */
    pidStart: number;
    /** The anchor's process group when it leads one (`gate-run`'s runner),
     *  else `null`. Members whose environment the reaper cannot read (a
     *  macOS platform binary hides it from `ps -E`) are found through it. */
    pgid: number | null;
    command: string;
    cwd: string;
    /** `true` for a spawner that removes its own cwd as part of succeeding. */
    cwdMayVanish: boolean;
    /** The lease this one was spawned under (the inherited tag), or `null`
     *  for a root: a detached gate run, a loop pass, a unit. */
    parent: string | null;
    startedAt: number;
    renewedAt: number;
    /** Epoch ms past which, unrenewed, the lease is expired. */
    deadline: number;
    /** Epoch ms until which the reaper takes NO action on this lease's tree
     *  — opened by a legitimate re-attach. `null` = none. */
    graceUntil: number | null;
}

const ID_RE = /^[A-Za-z0-9._:-]+$/;

/** The cache root every tooling state dir lives under — the same root
 *  `gate-run.sh` uses (`${XDG_CACHE_HOME:-$HOME/.cache}/tolaria`). */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "tolaria");
}

export function leaseDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.TOLARIA_LEASE_DIR || join(cacheRoot(env), "leases");
}

function leaseFile(dir: string, id: string): string {
    if (!ID_RE.test(id)) throw new Error(`process-lease: bad lease id '${id}'`);
    return join(dir, `${id}.json`);
}

/** A test hook, not a feature: every put/clear appends one line to the file
 *  `TOLARIA_LEASE_TRACE` names, so a spawner's test can observe a lease that
 *  existed only for the spawner's lifetime. */
function trace(env: NodeJS.ProcessEnv, line: string) {
    const f = env.TOLARIA_LEASE_TRACE;
    if (!f) return;
    try {
        appendFileSync(f, `${line}\n`);
    } catch {
        /* a trace never fails a spawner */
    }
}

export function writeLease(
    lease: ProcessLease,
    env: NodeJS.ProcessEnv = process.env
): void {
    const dir = leaseDir(env);
    mkdirSync(dir, { recursive: true });
    const file = leaseFile(dir, lease.id);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(lease));
    renameSync(tmp, file);
    trace(env, `put ${lease.id} ${lease.kind}`);
}

export function clearLease(
    id: string,
    env: NodeJS.ProcessEnv = process.env
): void {
    rmSync(leaseFile(leaseDir(env), id), { force: true });
    trace(env, `clear ${id}`);
}

function isLease(v: unknown): v is ProcessLease {
    const l = v as ProcessLease;
    return (
        typeof l === "object" &&
        l !== null &&
        typeof l.id === "string" &&
        ID_RE.test(l.id) &&
        typeof l.pid === "number" &&
        typeof l.deadline === "number" &&
        typeof l.cwd === "string"
    );
}

/** Every readable lease. A torn or foreign file is skipped, never fatal: the
 *  reaper must keep sweeping past one bad record. */
export function readLeases(
    env: NodeJS.ProcessEnv = process.env
): ProcessLease[] {
    const dir = leaseDir(env);
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const out: ProcessLease[] = [];
    for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
            const v: unknown = JSON.parse(
                readFileSync(join(dir, name), "utf8")
            );
            if (isLease(v)) out.push(v);
        } catch {
            /* torn write or foreign file */
        }
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function readLease(
    id: string,
    env: NodeJS.ProcessEnv = process.env
): ProcessLease | null {
    try {
        const v: unknown = JSON.parse(
            readFileSync(leaseFile(leaseDir(env), id), "utf8")
        );
        return isLease(v) ? v : null;
    } catch {
        return null;
    }
}

/** A lease's state as the reaper judges it. */
export type LeaseVerdict =
    | { alive: true; why: "grace" | "live" }
    | { alive: false; why: string; recycled?: true };

/** Seconds of slack between a lease's recorded start and the start the
 *  process table reports: `ps` rounds elapsed time to the second, and a shell
 *  spawner stamps the start a beat after the fork. */
export const PID_START_SLACK_S = 5;

/**
 * One lease, judged on its OWN record (the parent chain is the reaper's
 * fixpoint). `anchorStart` is the anchor pid's start in epoch seconds as the
 * process table reports it, `null` when no such pid runs.
 */
export function judgeLease(
    lease: ProcessLease,
    anchorStart: number | null,
    nowMs: number,
    cwdExists: (p: string) => boolean
): LeaseVerdict {
    if (lease.graceUntil !== null && nowMs < lease.graceUntil)
        return { alive: true, why: "grace" };
    if (anchorStart === null)
        return { alive: false, why: `its anchor pid ${lease.pid} is gone` };
    if (
        lease.pidStart > 0 &&
        Math.abs(anchorStart - lease.pidStart) > PID_START_SLACK_S
    )
        return {
            alive: false,
            why: `its anchor pid ${lease.pid} was recycled (started ${anchorStart}, lease says ${lease.pidStart})`,
            recycled: true,
        };
    if (nowMs > lease.deadline)
        return {
            alive: false,
            why: `the lease expired ${Math.round((nowMs - lease.deadline) / 1000)}s ago`,
        };
    if (!lease.cwdMayVanish && !cwdExists(lease.cwd))
        return { alive: false, why: `its cwd ${lease.cwd} no longer exists` };
    return { alive: true, why: "live" };
}

/** This process's start, epoch seconds. */
function selfStart(): number {
    return Math.floor(Date.now() / 1000 - process.uptime());
}

export interface HeldLease {
    id: string;
    release(): void;
}

/**
 * Register a lease for THIS process and tag everything it spawns from now on
 * (`process.env.TOLARIA_OWNER` — every `spawn` without an explicit `env`, and
 * every `{ ...process.env }` built after this call, inherits it). Renewed on
 * an unref'd timer (a busy event loop delays a renewal, so `ttlMs` is
 * generous, never tight); cleared on a normal exit. A signal death leaves
 * the lease behind with a dead anchor — which is exactly what tells the
 * reaper to take whatever the tree left running.
 *
 * Never throws: a spawner that cannot write its lease runs unleased (the
 * pattern net still covers its orphans).
 */
export function holdLease(opts: {
    kind: string;
    ttlMs: number;
    cwdMayVanish?: boolean;
    /** A tree that must OUTLIVE the process that spawned it (a detached
     *  health decision): its lease ignores the inherited tag, so its life is
     *  its own anchor's and not its spawner's. */
    root?: boolean;
    env?: NodeJS.ProcessEnv;
}): HeldLease | null {
    const env = opts.env ?? process.env;
    const now = Date.now();
    const id = `${opts.kind.replace(/[^A-Za-z0-9._-]/g, "-")}-${process.pid}-${now}`;
    const parent = opts.root ? null : env[OWNER_ENV] || null;
    const lease: ProcessLease = {
        id,
        kind: opts.kind,
        pid: process.pid,
        pidStart: selfStart(),
        pgid: null,
        command: process.argv.slice(1).join(" ").slice(0, 400),
        cwd: process.cwd(),
        cwdMayVanish: opts.cwdMayVanish ?? false,
        parent: parent && !parent.startsWith(UNIT_OWNER_PREFIX) ? parent : null,
        startedAt: now,
        renewedAt: now,
        deadline: now + opts.ttlMs,
        graceUntil: null,
    };
    try {
        writeLease(lease, env);
    } catch {
        return null;
    }
    env[OWNER_ENV] = id;
    const timer = setInterval(
        () => {
            const t = Date.now();
            try {
                writeLease(
                    { ...lease, renewedAt: t, deadline: t + opts.ttlMs },
                    env
                );
            } catch {
                /* the next beat retries */
            }
        },
        Math.max(1000, Math.floor(opts.ttlMs / 3))
    );
    timer.unref();
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        try {
            clearLease(id, env);
        } catch {
            /* best effort */
        }
    };
    process.on("exit", release);
    return { id, release };
}

// ── CLI for the shell spawners ──────────────────────────────────────────────
//
//   bun scripts/lib/process-lease.ts put <id> <kind> <pid> <ttl-secs> \
//       [--pgid N] [--cwd DIR] [--cwd-may-vanish] [--parent ID] [--command STR]
//   bun scripts/lib/process-lease.ts renew <id> <ttl-secs> [--grace SECS]
//   bun scripts/lib/process-lease.ts clear <id>
//
// Always exits 0 — a lease write never fails a gate — printing the reason on
// stderr when it could not write.

function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

/** The anchor's start, read from the process table (`etime`), so a shell
 *  caller need not stamp it. */
function pidStartOf(pid: number): number {
    try {
        const r = spawnSync("ps", ["-o", "etime=", "-p", String(pid)], {
            encoding: "utf8",
            timeout: 5000,
        });
        const s = parseEtime(r.stdout ?? "");
        return s === null ? 0 : Math.floor(Date.now() / 1000) - s;
    } catch {
        return 0;
    }
}

/** `ps -o etime` — `[[dd-]hh:]mm:ss` — in seconds; `null` if unparsable. */
export function parseEtime(s: string): number | null {
    const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
    if (!m) return null;
    const [, d, h, mi, se] = m;
    return (
        Number(d ?? 0) * 86400 +
        Number(h ?? 0) * 3600 +
        Number(mi) * 60 +
        Number(se)
    );
}

function cli(argv: string[]): void {
    const [verb, ...args] = argv;
    const now = Date.now();
    if (verb === "put") {
        const [id, kind, pid, ttl] = args;
        const pgid = flag(args, "--pgid");
        writeLease({
            id,
            kind,
            pid: Number(pid),
            pidStart: pidStartOf(Number(pid)),
            pgid: pgid ? Number(pgid) : null,
            command: (flag(args, "--command") ?? "").slice(0, 400),
            cwd: flag(args, "--cwd") ?? process.cwd(),
            cwdMayVanish: args.includes("--cwd-may-vanish"),
            parent: flag(args, "--parent") || null,
            startedAt: now,
            renewedAt: now,
            deadline: now + Number(ttl) * 1000,
            graceUntil: null,
        });
    } else if (verb === "renew") {
        const [id, ttl] = args;
        const lease = readLease(id);
        if (lease === null) return;
        const grace = flag(args, "--grace");
        writeLease({
            ...lease,
            renewedAt: now,
            deadline: Math.max(lease.deadline, now + Number(ttl) * 1000),
            graceUntil: grace ? now + Number(grace) * 1000 : lease.graceUntil,
        });
    } else if (verb === "clear") {
        clearLease(args[0]);
    } else {
        throw new Error(`unknown verb '${verb ?? ""}'`);
    }
}

if (import.meta.main) {
    try {
        cli(process.argv.slice(2));
    } catch (err) {
        console.error(`process-lease: ${(err as Error).message}`);
    }
}
