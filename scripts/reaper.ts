#!/usr/bin/env bun
// `bun run reaper` — the ACTIVE reaper (issue #5470): one sweep of the process
// table that terminates every tree the tooling spawned and nobody owns any
// more. A `launchd` agent (MacBook) and a `systemd` timer (Huawei) run it
// every 2 minutes (`docs/guides/huawei-runner.md` § The reaper).
//
// What it kills, and why — each kill is logged with its reason:
//
//   1. a LEASED tree (`scripts/lib/process-lease.ts`) whose lease is dead:
//      its anchor is gone or was recycled, its deadline passed unrenewed, its
//      cwd was removed (a deleted worktree), or its parent lease is dead —
//      the anchor itself, every process TAGGED with the lease
//      (`TOLARIA_OWNER`, read from the environment whatever the binary is),
//      the anchor's process group, and their descendants;
//   2. a process tagged with a lease nobody REGISTERED, once it is older than
//      a short race margin;
//   3. belt and braces, an UNTAGGED ORPHAN — re-parented to pid 1 (or to a
//      `systemd --user` subreaper) — matching the tooling's command patterns
//      (vitest, vite, Chromium under the Playwright cache,
//      `convex-local-backend`, `bun scripts/*`, `claude -p`) past an age
//      threshold: a process started by hand and abandoned.
//
// What it never touches: itself and its ancestors, pid 1, another uid's
// processes, a LIVE lease's anchor and anything tagged with a live lease, a
// tree whose lease is inside the grace window a legitimate re-attach opened,
// and anything tagged `unit:*` (a service manager's own tree). An orphan
// with a live parent chain is not an orphan: a dev server started from a
// terminal has its shell for a parent and is never matched.
//
// `--dry-run` prints what one sweep would kill and why, and changes nothing.

import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
    renameSync,
} from "node:fs";
import { join } from "node:path";
import {
    cacheRoot,
    clearLease,
    judgeLease,
    OWNER_ENV,
    parseEtime,
    readLease,
    readLeases,
    UNIT_OWNER_PREFIX,
    type LeaseVerdict,
    type ProcessLease,
} from "./lib/process-lease";

/** One process as a sweep sees it. `owner` is its `TOLARIA_OWNER` tag, `null`
 *  when untagged OR unreadable (a macOS platform binary hides its env). */
export interface ProcRow {
    pid: number;
    ppid: number;
    pgid: number;
    uid: number;
    ageS: number;
    command: string;
    owner: string | null;
}

export interface SweepConfig {
    /** An untagged orphan matching a pattern is reaped past this age. */
    orphanMinAgeS: number;
    /** A process tagged with an unregistered lease is reaped past this age —
     *  the margin between a spawner's fork and its lease write. */
    unknownOwnerMinAgeS: number;
}

/** Both under the 2-minute sweep interval, so a stray is taken by the first
 *  sweep after it is eligible — and over the few hundred milliseconds a
 *  spawner needs between its fork and its lease write. */
export const DEFAULT_CONFIG: SweepConfig = {
    orphanMinAgeS: 60,
    unknownOwnerMinAgeS: 60,
};

export interface Kill {
    pid: number;
    command: string;
    /** The lease the kill is attributed to, `null` for the pattern net. */
    lease: string | null;
    reason: string;
}

export interface SweepPlan {
    kills: Kill[];
    verdicts: { lease: ProcessLease; verdict: LeaseVerdict }[];
}

/** The tooling's command patterns — the net for untagged strays. Named, so a
 *  kill's reason says which one matched. */
export const TOOLING_PATTERNS: readonly { name: string; re: RegExp }[] = [
    { name: "vitest", re: /\bvitest\b/ },
    { name: "vite", re: /(^|[\s/])vite(\.js)?(\s|$)/ },
    { name: "playwright chromium", re: /ms-playwright\/.*chrom/i },
    { name: "convex-local-backend", re: /convex-local-backend/ },
    {
        name: "bun scripts/*",
        re: /(^|\/)bun\s+(run\s+)?(\S*\/)?scripts\/\S+\.(ts|mjs|js|sh)\b/,
    },
    { name: "claude -p", re: /(^|\/)claude\s(.*\s)?-p(\s|$)/ },
];

function patternOf(command: string): string | null {
    return TOOLING_PATTERNS.find((p) => p.re.test(command))?.name ?? null;
}

/** A `systemd --user` instance is a subreaper on Linux: an orphan in a user
 *  session is re-parented to it, not to pid 1. */
function isSubreaper(row: ProcRow | undefined): boolean {
    return row !== undefined && /(^|\/)systemd\s+--user\b/.test(row.command);
}

const isUnitTag = (owner: string | null) =>
    owner !== null && owner.startsWith(UNIT_OWNER_PREFIX);

/**
 * One sweep's decision — PURE over its inputs, so every rule is testable
 * against a fake process table.
 */
export function planSweep(input: {
    rows: readonly ProcRow[];
    leases: readonly ProcessLease[];
    nowMs: number;
    selfPid: number;
    uid: number;
    cwdExists: (p: string) => boolean;
    config?: SweepConfig;
}): SweepPlan {
    const cfg = input.config ?? DEFAULT_CONFIG;
    const nowS = Math.floor(input.nowMs / 1000);
    const byPid = new Map(input.rows.map((r) => [r.pid, r]));
    const children = new Map<number, ProcRow[]>();
    for (const r of input.rows) {
        const list = children.get(r.ppid) ?? [];
        list.push(r);
        children.set(r.ppid, list);
    }

    // Never: pid ≤ 1, another uid, this sweep and its ancestors.
    const protectedPids = new Set<number>();
    for (
        let p: number | undefined = input.selfPid;
        p !== undefined && p > 1 && !protectedPids.has(p);
        p = byPid.get(p)?.ppid
    )
        protectedPids.add(p);
    const untouchable = (r: ProcRow) =>
        r.pid <= 1 || r.uid !== input.uid || protectedPids.has(r.pid);

    // Each lease on its own record, then the parent chain to a fixpoint: a
    // lease spawned under a dead (or vanished) lease is dead too — unless it
    // is inside its own grace window.
    const leases = new Map(input.leases.map((l) => [l.id, l]));
    const verdict = new Map<string, LeaseVerdict>();
    for (const l of input.leases) {
        const row = byPid.get(l.pid);
        verdict.set(
            l.id,
            judgeLease(
                l,
                row === undefined ? null : nowS - row.ageS,
                input.nowMs,
                input.cwdExists
            )
        );
    }
    for (let changed = true; changed; ) {
        changed = false;
        for (const l of input.leases) {
            const v = verdict.get(l.id)!;
            if (!v.alive || v.why === "grace" || l.parent === null) continue;
            const pv = verdict.get(l.parent);
            if (pv === undefined || !pv.alive) {
                verdict.set(l.id, {
                    alive: false,
                    why:
                        pv === undefined
                            ? `its parent lease ${l.parent} is gone`
                            : `its parent lease ${l.parent} is dead (${pv.why})`,
                });
                changed = true;
            }
        }
    }
    const alive = (id: string) => verdict.get(id)?.alive === true;
    // A live lease's anchor — judged by its own lease, whatever tag it was
    // born with (a detached gate run's runner carries its spawner's tag).
    const liveAnchors = new Set(
        input.leases
            .filter((l) => alive(l.id) && byPid.has(l.pid))
            .map((l) => l.pid)
    );
    const spared = (r: ProcRow) =>
        untouchable(r) ||
        liveAnchors.has(r.pid) ||
        isUnitTag(r.owner) ||
        (r.owner !== null && alive(r.owner));

    const kills = new Map<number, Kill>();
    const take = (r: ProcRow, lease: string | null, reason: string) => {
        if (!kills.has(r.pid) && !spared(r))
            kills.set(r.pid, { pid: r.pid, command: r.command, lease, reason });
    };

    for (const l of input.leases) {
        const v = verdict.get(l.id)!;
        if (v.alive) continue;
        const anchor = byPid.get(l.pid);
        // A recycled pid is not the anchor: its new tenant is someone else's.
        if (anchor && !v.recycled)
            take(anchor, l.id, `anchor of lease ${l.id}: ${v.why}`);
        for (const r of input.rows) {
            if (r.owner === l.id)
                take(r, l.id, `tagged with lease ${l.id}: ${v.why}`);
            else if (
                l.pgid !== null &&
                r.pgid === l.pgid &&
                r.owner === null &&
                !v.recycled
            )
                take(
                    r,
                    l.id,
                    `in the process group of lease ${l.id}: ${v.why}`
                );
        }
    }
    for (const r of input.rows) {
        if (r.owner === null || isUnitTag(r.owner) || leases.has(r.owner))
            continue;
        if (r.ageS >= cfg.unknownOwnerMinAgeS)
            take(
                r,
                r.owner,
                `tagged with lease ${r.owner}, which is not registered (age ${r.ageS}s)`
            );
    }
    for (const r of input.rows) {
        if (r.owner !== null || r.ageS < cfg.orphanMinAgeS) continue;
        if (r.ppid !== 1 && !isSubreaper(byPid.get(r.ppid))) continue;
        const name = patternOf(r.command);
        if (name !== null)
            take(
                r,
                null,
                `untagged orphan matching '${name}' with no lease (parent pid ${r.ppid}, age ${r.ageS}s)`
            );
    }

    // The trees under every kill — stopping at anything spared, so a live
    // detached gate still parented to a dead pass's waiter survives it.
    const queue = [...kills.values()];
    while (queue.length > 0) {
        const k = queue.shift()!;
        for (const c of children.get(k.pid) ?? []) {
            if (kills.has(c.pid) || spared(c)) continue;
            const kill: Kill = {
                pid: c.pid,
                command: c.command,
                lease: k.lease,
                reason: `descendant of pid ${k.pid} (${k.reason})`,
            };
            kills.set(c.pid, kill);
            queue.push(kill);
        }
    }

    return {
        kills: [...kills.values()],
        verdicts: input.leases.map((lease) => ({
            lease,
            verdict: verdict.get(lease.id)!,
        })),
    };
}

// ── the process table ───────────────────────────────────────────────────────

/** `ps` rows WITHOUT the owner tag; `null` when `ps` failed. */
export function parsePsRows(stdout: string): Omit<ProcRow, "owner">[] {
    const out: Omit<ProcRow, "owner">[] = [];
    for (const line of stdout.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(
            line
        );
        if (!m) continue;
        const age = parseEtime(m[5]);
        if (age === null) continue;
        out.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            uid: Number(m[4]),
            ageS: age,
            command: m[6],
        });
    }
    return out;
}

const TAG_RE = new RegExp(`(?:^|\\s)${OWNER_ENV}=(\\S+)`, "g");

/** macOS `ps -E` output → pid → tag. The environment trails the command, so
 *  the LAST match is the environment's, not an argument's. */
export function parseEnvTags(stdout: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const line of stdout.split("\n")) {
        const m = /^\s*(\d+)\s(.*)$/.exec(line);
        if (!m) continue;
        const all = [...m[2].matchAll(TAG_RE)];
        if (all.length > 0) out.set(Number(m[1]), all[all.length - 1][1]);
    }
    return out;
}

function readTagsLinux(pids: number[]): Map<number, string> {
    const out = new Map<number, string>();
    for (const pid of pids) {
        try {
            const env = readFileSync(`/proc/${pid}/environ`, "utf8");
            for (const kv of env.split("\0"))
                if (kv.startsWith(`${OWNER_ENV}=`)) {
                    out.set(pid, kv.slice(OWNER_ENV.length + 1));
                    break;
                }
        } catch {
            /* gone, or not ours */
        }
    }
    return out;
}

export function readProcessTable(): ProcRow[] | null {
    const ps = spawnSync(
        "ps",
        ["-axww", "-o", "pid=,ppid=,pgid=,uid=,etime=,command="],
        { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 * 1024 }
    );
    if (ps.status !== 0) return null;
    const rows = parsePsRows(ps.stdout);
    const uid = process.getuid?.() ?? -1;
    let tags: Map<number, string>;
    if (process.platform === "linux") {
        tags = readTagsLinux(
            rows.filter((r) => r.uid === uid).map((r) => r.pid)
        );
    } else {
        const env = spawnSync("ps", ["-axwwE", "-o", "pid=,command="], {
            encoding: "utf8",
            timeout: 15_000,
            maxBuffer: 64 * 1024 * 1024,
        });
        tags = env.status === 0 ? parseEnvTags(env.stdout) : new Map();
    }
    return rows.map((r) => ({ ...r, owner: tags.get(r.pid) ?? null }));
}

// ── the sweep ───────────────────────────────────────────────────────────────

export function reaperDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.TOLARIA_REAPER_DIR || join(cacheRoot(env), "reaper");
}

export interface SweepRecord {
    at: string;
    dryRun: boolean;
    processes: number;
    leases: number;
    liveLeases: number;
    killed: number;
    survivors: number[];
    ms: number;
}

export function readLastSweep(
    env: NodeJS.ProcessEnv = process.env
): SweepRecord | null {
    try {
        return JSON.parse(
            readFileSync(join(reaperDir(env), "last-sweep.json"), "utf8")
        ) as SweepRecord;
    } catch {
        return null;
    }
}

const LOG_CAP_BYTES = 2 * 1024 * 1024;

function appendLog(file: string, lines: string[]) {
    if (lines.length === 0) return;
    try {
        if (existsSync(file) && statSync(file).size > LOG_CAP_BYTES) {
            const keep = readFileSync(file, "utf8").slice(-LOG_CAP_BYTES / 2);
            writeFileSync(file, keep.slice(keep.indexOf("\n") + 1));
        }
        appendFileSync(file, lines.map((l) => `${l}\n`).join(""));
    } catch {
        /* the log never fails a sweep */
    }
}

function aliveAfter(pids: number[]): number[] {
    return pids.filter((pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    });
}

function signal(pids: number[], sig: NodeJS.Signals) {
    for (const pid of pids)
        try {
            process.kill(pid, sig);
        } catch {
            /* already gone */
        }
}

async function terminate(pids: number[], graceMs: number): Promise<number[]> {
    signal(pids, "SIGTERM");
    const until = Date.now() + graceMs;
    let left = aliveAfter(pids);
    while (left.length > 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 200));
        left = aliveAfter(left);
    }
    if (left.length === 0) return [];
    signal(left, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    return aliveAfter(left);
}

/** One sweep at a time per machine: a launchd tick and a hand-typed run must
 *  not signal the same tree twice. A lock older than 10 minutes is stale. */
function takeLock(dir: string): (() => void) | null {
    const lock = join(dir, "sweep.lock");
    try {
        mkdirSync(lock);
    } catch {
        try {
            if (Date.now() - statSync(lock).mtimeMs < 10 * 60_000) return null;
            rmSync(lock, { recursive: true, force: true });
            mkdirSync(lock);
        } catch {
            return null;
        }
    }
    return () => rmSync(lock, { recursive: true, force: true });
}

function short(cmd: string): string {
    return cmd.length > 140 ? `${cmd.slice(0, 137)}...` : cmd;
}

export async function sweep(opts: {
    dryRun: boolean;
    graceMs: number;
    config: SweepConfig;
}): Promise<number> {
    const t0 = Date.now();
    const dir = reaperDir();
    mkdirSync(dir, { recursive: true });
    const unlock = opts.dryRun ? () => {} : takeLock(dir);
    if (unlock === null) {
        console.log("reaper: another sweep holds the lock — skipped");
        return 0;
    }
    try {
        // Leases BEFORE the process table: a lease written after the snapshot
        // would read as "anchor gone" for a process the snapshot never saw.
        const leases = readLeases();
        const rows = readProcessTable();
        if (rows === null) {
            console.error("reaper: ps failed — nothing swept");
            return 1;
        }
        const plan = planSweep({
            rows,
            leases,
            nowMs: Date.now(),
            selfPid: process.pid,
            uid: process.getuid?.() ?? -1,
            cwdExists: existsSync,
            config: opts.config,
        });
        const iso = new Date().toISOString();
        const verb = opts.dryRun ? "would reap" : "reaped";
        const lines = plan.kills.map(
            (k) =>
                `${iso} ${verb} pid ${k.pid} (${short(k.command)}) [${k.lease ?? "no lease"}]: ${k.reason}`
        );
        for (const line of lines) console.log(`reaper: ${line}`);
        let survivors: number[] = [];
        if (!opts.dryRun) {
            survivors = await terminate(
                plan.kills.map((k) => k.pid),
                opts.graceMs
            );
            appendLog(join(dir, "reaped.log"), [
                ...lines,
                ...survivors.map(
                    (pid) =>
                        `${iso} could NOT terminate pid ${pid} — left in place, retried next sweep`
                ),
            ]);
            // A dead lease's record goes with its tree — unless a re-attach
            // renewed it since this sweep read it.
            for (const { lease, verdict } of plan.verdicts) {
                if (verdict.alive) continue;
                if (readLease(lease.id)?.renewedAt !== lease.renewedAt)
                    continue;
                try {
                    clearLease(lease.id);
                } catch {
                    /* next sweep */
                }
            }
        }
        const live = plan.verdicts.filter((v) => v.verdict.alive).length;
        for (const { lease, verdict } of plan.verdicts)
            if (!verdict.alive)
                console.log(
                    `reaper: lease ${lease.id} (${lease.kind}) is dead — ${verdict.why}`
                );
        const record: SweepRecord = {
            at: iso,
            dryRun: opts.dryRun,
            processes: rows.length,
            leases: leases.length,
            liveLeases: live,
            killed: plan.kills.length - survivors.length,
            survivors,
            ms: Date.now() - t0,
        };
        if (!opts.dryRun) {
            const f = join(dir, "last-sweep.json");
            writeFileSync(`${f}.tmp`, JSON.stringify(record));
            renameSync(`${f}.tmp`, f);
        }
        console.log(
            `reaper: ${opts.dryRun ? "[dry-run] " : ""}${rows.length} processes, ${leases.length} leases (${live} live), ${plan.kills.length} ${opts.dryRun ? "to reap" : "reaped"}${survivors.length > 0 ? `, ${survivors.length} SURVIVED` : ""} in ${record.ms} ms`
        );
        return 0;
    } finally {
        unlock();
    }
}

function numFlag(args: string[], name: string, fallback: number): number {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    const n = Number(args[i + 1]);
    if (!Number.isFinite(n) || n < 0) {
        console.error(`reaper: ${name} needs a non-negative number`);
        process.exit(2);
    }
    return n;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    process.exit(
        await sweep({
            dryRun: args.includes("--dry-run"),
            graceMs: numFlag(args, "--grace", 5) * 1000,
            config: {
                orphanMinAgeS: numFlag(
                    args,
                    "--orphan-min-age",
                    DEFAULT_CONFIG.orphanMinAgeS
                ),
                unknownOwnerMinAgeS: numFlag(
                    args,
                    "--unknown-owner-min-age",
                    DEFAULT_CONFIG.unknownOwnerMinAgeS
                ),
            },
        })
    );
}
