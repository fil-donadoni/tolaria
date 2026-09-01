#!/usr/bin/env bun
/**
 * CPU admission control for the quality gates.
 *
 * WHY. This repo is worked by several concurrent Claude Code sessions/subagents,
 * each in its own git worktree. Every one of them runs vitest, `tsc -b` and
 * eslint. Vitest defaults to `ncpu - 1` workers per invocation, so on an 8-core
 * machine four concurrent subagents spawn ~28 test workers plus four type-checks
 * plus four lints — measured load average 45 on 8 cores. Telemetry
 * (.claude/telemetry/tool-events.jsonl, aggregated by scripts/agent-timing-report.ts):
 * 53.7h of foreground gate wall-clock, 22.7h of it contended, ~4.9h of pure
 * contention waste, `check:all` 67s solo vs 110s contended, targeted vitest 4s vs
 * 10s, and the bot suite blowing its 60s per-test ceiling under load — i.e.
 * FALSE REDS, whose debugging cost dwarfs the raw slowdown.
 *
 * MODEL. Two tiers:
 *
 *   heavy — the full suites and `check:all`. Hold a machine-wide exclusive
 *           mutex and get the full worker count. One at a time, but each runs
 *           at solo speed instead of N running at 1/N speed. Callers queue.
 *   light — targeted vitest, `check:ts`, `lint`. No lock, but vitest is capped
 *           at TOLARIA_VITEST_WORKERS (default 2, see vitest.config.ts), so
 *           four concurrent light jobs fit in ncpu.
 *
 * The lock lives OUTSIDE the repo ($HOME/.cache/tolaria) on purpose: worktrees
 * are separate directories, so an in-repo lock would not be shared between them.
 *
 * LIVENESS. The owner stamp is a heartbeat, and a heartbeat that only attests
 * to the GATE process being alive attests to nothing: issue #2999 measured a
 * `health:main` whose vitest hung at startup — 16.86 s of CPU in 2h13m, zero
 * worker children — keep stamping a fresh timestamp for over two hours while
 * three sessions queued behind it. `alive(pid)` was true and the stamp was
 * never stale, so no waiter could ever reclaim it. The heartbeat therefore
 * attests to PROGRESS: it refreshes only while the held subtree's cumulative
 * CPU time is still advancing, and a subtree frozen for STALL_BEATS beats
 * stops the refresh, handing the lock to the existing STALE_MS reclaim path.
 *
 * Usage:
 *   bun scripts/gate.ts heavy '<shell command>'
 *   bun scripts/gate.ts light '<shell command>'
 *   bun scripts/gate.ts who              # who holds the mutex, and is it alive?
 *
 * Env:
 *   TOLARIA_GATE_HELD=1        set by this script for the child; a nested heavy
 *                              call passes straight through (no self-deadlock)
 *   TOLARIA_ALLOW_FULL_SUITE=1 escape hatch for the issue-worktree guard
 *   TOLARIA_VITEST_WORKERS     worker cap read by vitest.config.ts
 *   TOLARIA_GATE_LOCK_ROOT     lock location override (tests only)
 *   TOLARIA_GATE_HEARTBEAT_MS  owner-stamp refresh period override (tests only)
 *   TOLARIA_GATE_STALE_MS      staleness threshold override (tests only)
 *   TOLARIA_GATE_STALL_BEATS   no-progress beats before a holder stops
 *                              heartbeating (tests only)
 */
import { spawn, spawnSync } from "node:child_process";
import {
    mkdirSync,
    rmSync,
    readFileSync,
    writeFileSync,
    appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, cpus } from "node:os";

// Overridable so the test suite can exercise the mutex against a temp dir
// instead of contending with (or blocking) a real gate run on this machine.
const LOCK_ROOT =
    process.env.TOLARIA_GATE_LOCK_ROOT ?? join(homedir(), ".cache", "tolaria");
const LOCK_DIR = join(LOCK_ROOT, "gate.lock");
const OWNER_FILE = join(LOCK_DIR, "owner.json");
/** A lock whose owner stamp is older than this is assumed orphaned even if its
 *  pid still exists. `ts` is a HEARTBEAT, not the acquisition time: the holder
 *  refreshes it every HEARTBEAT_MS for as long as its subtree keeps making
 *  progress (issue #1924 — a ladder run legitimately holds for hours), so only
 *  a holder that stopped heartbeating for 45 min is pruned. Dead-pid pruning is
 *  unchanged and remains the primary path.
 *  Overridable so the test suite can drive the whole stall → reclaim path in
 *  milliseconds rather than in three quarters of an hour. */
const STALE_MS = Number(process.env.TOLARIA_GATE_STALE_MS ?? 45 * 60 * 1000);
/** Owner-stamp refresh period while the heavy tier holds the lock.
 *  Overridable so the test suite can observe a refresh in milliseconds. */
const HEARTBEAT_MS = Number(
    process.env.TOLARIA_GATE_HEARTBEAT_MS ?? 5 * 60 * 1000
);
/** Consecutive beats with ZERO subtree CPU progress after which the holder
 *  stops attesting to its own liveness. Three beats ≈ 15 min of a completely
 *  frozen subtree at the default period — far beyond any pause a real gate
 *  takes (a `gh` API call inside `land` is seconds), and far under the 2h13m
 *  issue #2999 measured. */
const STALL_BEATS = Number(process.env.TOLARIA_GATE_STALL_BEATS ?? 3);
const POLL_MS = 2000;
const NCPU = cpus().length;
/** Full-speed worker count for the heavy tier — leave one core for the OS. */
const HEAVY_WORKERS = Math.max(2, NCPU - 1);

const [, , tier, ...rest] = process.argv;
const command = rest.join(" ");

// ── lock ────────────────────────────────────────────────────────────────────
interface Owner {
    pid: number;
    label: string;
    cwd: string;
    /** Heartbeat: last time the holder attested to its subtree's PROGRESS. */
    ts: number;
    /** When the lock was taken. Optional: a lock written by an older gate (or
     *  by a test fixture) carries only `ts`, and held-for falls back to it. */
    acquiredAt?: number;
}

function readOwner(): Owner | null {
    try {
        return JSON.parse(readFileSync(OWNER_FILE, "utf8")) as Owner;
    } catch {
        return null;
    }
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** `ps` CPU time — `[[DD-]HH:]MM:SS[.ss]` on macOS, `[DD-]HH:MM:SS` on Linux. */
function parseCpuMs(field: string): number | null {
    let rest = field;
    let days = 0;
    const dash = rest.indexOf("-");
    if (dash >= 0) {
        days = Number(rest.slice(0, dash));
        rest = rest.slice(dash + 1);
    }
    const parts = rest.split(":").map(Number);
    if (!Number.isFinite(days) || parts.some((n) => !Number.isFinite(n)))
        return null;
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
    return Math.round((days * 86_400 + seconds) * 1000);
}

/**
 * Cumulative CPU time of every DESCENDANT of `pid`, in ms — the cheapest signal
 * that a held subtree is still doing work, and one that needs no cooperation
 * from the wrapped command.
 *
 * The gate process itself is excluded on purpose: it burns essentially nothing
 * but a timer, so including it would let the heartbeat attest to its own
 * existence again — exactly the tautology issue #2999 is about.
 *
 * Returns null when the measurement is unavailable (no `ps`, unparseable
 * output). Callers must treat null as "unknown" and keep the holder, never as
 * "stalled": reclaiming a healthy holder is the worse failure.
 */
function subtreeCpuMs(pid: number): number | null {
    const r = spawnSync("ps", ["-Ao", "pid=,ppid=,time="], {
        encoding: "utf8",
    });
    if (r.status !== 0 || !r.stdout) return null;
    const children = new Map<number, number[]>();
    const cpu = new Map<number, number>();
    for (const line of r.stdout.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
        if (!m) continue;
        const [, kid, parent, time] = m;
        const ms = parseCpuMs(time);
        if (ms === null) continue;
        cpu.set(Number(kid), ms);
        const bucket = children.get(Number(parent));
        if (bucket) bucket.push(Number(kid));
        else children.set(Number(parent), [Number(kid)]);
    }
    if (cpu.size === 0) return null;
    let total = 0;
    const queue = [...(children.get(pid) ?? [])];
    const seen = new Set<number>();
    while (queue.length) {
        const next = queue.pop()!;
        if (seen.has(next)) continue;
        seen.add(next);
        total += cpu.get(next) ?? 0;
        queue.push(...(children.get(next) ?? []));
    }
    return total;
}

function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** The one line every waiter prints: who holds the mutex, from where, since
 *  when, and when it last attested to progress. Everything here was already in
 *  owner.json during the issue #2999 incident and simply never shown — three
 *  sessions sat blocked and had to reconstruct it by hand from `ps`. */
function holderLine(owner: Owner, now = Date.now()): string {
    return [
        `pid ${owner.pid}`,
        `held ${fmtDuration(now - (owner.acquiredAt ?? owner.ts))}`,
        `last progress ${fmtDuration(now - owner.ts)} ago`,
        owner.cwd,
        owner.label,
    ].join(" · ");
}

/** Atomic: mkdir fails if the directory exists. Returns true when acquired. */
function tryAcquire(): boolean {
    try {
        mkdirSync(LOCK_DIR, { recursive: false });
    } catch {
        return false;
    }
    const now = Date.now();
    const owner: Owner = {
        pid: process.pid,
        label: command.slice(0, 120),
        cwd: process.cwd(),
        ts: now,
        acquiredAt: now,
    };
    writeFileSync(OWNER_FILE, JSON.stringify(owner));
    return true;
}

function release() {
    const owner = readOwner();
    if (owner && owner.pid !== process.pid) return; // not ours — never steal on exit
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
}

/** Telemetry: how long callers actually queue, so the tier split can be tuned,
 *  and every reclaim, so a lock freed because its holder went silent is
 *  distinguishable in a log from one released normally (which logs nothing). */
function logEvent(entry: Record<string, unknown>) {
    const dir = join(
        process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
        ".claude",
        "telemetry"
    );
    try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, "gate-lock.jsonl"),
            JSON.stringify({
                ts: Math.floor(Date.now() / 1000),
                tier,
                cwd: process.cwd(),
                cmd: command.slice(0, 120),
                ...entry,
            }) + "\n"
        );
    } catch {
        /* telemetry is never load-bearing */
    }
}

function logWait(waitedMs: number) {
    if (!process.env.CLAUDE_PROJECT_DIR && waitedMs < 1000) return;
    logEvent({ event: "acquired", waited_ms: waitedMs });
}

async function acquire() {
    mkdirSync(LOCK_ROOT, { recursive: true });
    const t0 = Date.now();
    let announcedFor: number | null = null;
    let lastAnnounce = 0;
    for (;;) {
        if (tryAcquire()) {
            logWait(Date.now() - t0);
            return;
        }
        const owner = readOwner();
        const now = Date.now();
        // Prune a lock whose holder died, or one that stopped attesting to
        // progress. The two are different failures and read differently:
        // an absent pid is an orphan, a live pid that went silent is a HUNG
        // holder (issue #2999) and the command it wrapped is still running.
        const dead = !owner || !alive(owner.pid);
        const silent = !!owner && now - owner.ts > STALE_MS;
        if (dead || silent) {
            const why = dead
                ? `holder is gone (${owner ? holderLine(owner, now) : "no readable owner"})`
                : `STALLED holder — pid ${owner.pid} is alive but has not attested to progress in ${fmtDuration(now - owner.ts)} (${holderLine(owner, now)})`;
            console.error(`[gate] reclaiming the heavy mutex — ${why}`);
            logEvent({
                event: "reclaimed",
                reason: dead ? "dead" : "stalled",
                holder_pid: owner?.pid ?? null,
                holder_cwd: owner?.cwd ?? null,
                holder_label: owner?.label ?? null,
                silent_ms: owner ? now - owner.ts : null,
            });
            try {
                rmSync(LOCK_DIR, { recursive: true, force: true });
            } catch {
                /* another waiter pruned it first */
            }
            continue;
        }
        // Name the holder immediately, again whenever the holder changes, and
        // on every retry line — a waiter that says only "still waiting" tells
        // the blocked session nothing it can act on.
        const retryDue = now - lastAnnounce >= 60_000;
        if (announcedFor !== owner.pid || retryDue) {
            const waited = fmtDuration(now - t0);
            console.error(
                `[gate] waiting ${waited} for the heavy mutex — ${holderLine(owner, now)}`
            );
            announcedFor = owner.pid;
            lastAnnounce = now;
        }
        await new Promise((r) => setTimeout(r, POLL_MS + Math.random() * 500));
    }
}

// ── `who` — the diagnosis in one command ────────────────────────────────────
function who(): number {
    const owner = readOwner();
    if (!owner) {
        console.log("[gate] heavy mutex is free");
        return 0;
    }
    const now = Date.now();
    console.log(`[gate] heavy mutex — ${holderLine(owner, now)}`);
    const live = alive(owner.pid);
    const cpu = subtreeCpuMs(owner.pid);
    console.log(
        `[gate]   holder pid ${live ? "alive" : "GONE"} · subtree CPU ${
            cpu === null ? "unmeasurable" : `${(cpu / 1000).toFixed(2)}s`
        } · reclaimable in ${fmtDuration(STALE_MS - (now - owner.ts))}`
    );
    if (!live)
        console.log("[gate]   holder is dead — the next waiter reclaims it");
    else if (now - owner.ts > STALE_MS)
        console.log(
            "[gate]   holder went silent — the next waiter reclaims it"
        );
    return 0;
}

if (tier === "who") process.exit(who());

if ((tier !== "heavy" && tier !== "light") || !command) {
    console.error(
        "usage: bun scripts/gate.ts <heavy|light> '<shell command>' | bun scripts/gate.ts who"
    );
    process.exit(2);
}

// ── issue-worktree guard ────────────────────────────────────────────────────
// The merge-train is the only place the full gate runs (process-gh-issues §4).
// An implement-subagent working an issue branch must run targeted tests only.
// That rule used to live in prose and was measurably ignored — this makes it code.
function currentBranch(): string {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : "";
}

function isIssueWorktree(): boolean {
    if (/^(feat|fix)\/issue-\d+$/.test(currentBranch())) return true;
    return /tolaria-issue-\d+/.test(process.cwd());
}

if (
    tier === "heavy" &&
    !process.env.TOLARIA_GATE_HELD &&
    !process.env.TOLARIA_ALLOW_FULL_SUITE &&
    isIssueWorktree()
) {
    console.error(
        [
            "",
            "  ✗ Full gate blocked: this is an issue worktree.",
            "",
            "    The full suite and `check:all` are orchestrator-owned — they run once",
            "    per landing tree in the merge-train, on the rebased state that actually",
            "    lands (process-gh-issues §4 step 3). Running them here pays for a gate",
            "    that is re-paid at the train, and saturates the CPU of every other",
            "    subagent working in parallel.",
            "",
            "    Run the light pre-PR gate instead:",
            "      bunx vitest run <paths touched by the diff>",
            "      bun run check:pr    # same checks as check:all, no mutex",
            "",
            "    Genuinely need the full suite here? TOLARIA_ALLOW_FULL_SUITE=1 bun run test",
            "",
        ].join("\n")
    );
    process.exit(1);
}

// ── run ─────────────────────────────────────────────────────────────────────
/**
 * Refresh the owner stamp only while the held subtree is still burning CPU.
 *
 * A holder that has made no progress for STALL_BEATS consecutive beats stops
 * refreshing for good: the lock then ages past STALE_MS and the ordinary
 * reclaim path in `acquire()` takes it. Nothing here kills the wrapped command
 * — it may yet come back — it only stops the gate vouching for it.
 *
 * The first beat has no baseline to compare against, so detection costs
 * STALL_BEATS + 1 beats.
 */
function startHeartbeat() {
    let lastCpuMs = -1;
    let silentBeats = 0;
    let stalled = false;
    const hb = setInterval(() => {
        if (stalled) return;
        const owner = readOwner();
        if (!owner || owner.pid !== process.pid) return; // not ours
        const cpu = subtreeCpuMs(process.pid);
        if (cpu === null || cpu > lastCpuMs) {
            // Unmeasurable counts as progress: never reclaim a holder we
            // cannot judge.
            if (cpu !== null) lastCpuMs = cpu;
            silentBeats = 0;
        } else if (++silentBeats >= STALL_BEATS) {
            stalled = true;
            console.error(
                [
                    `[gate] STALLED — the held subtree has burned no CPU for ${silentBeats} beats`,
                    `(${(cpu / 1000).toFixed(2)}s total, held ${fmtDuration(Date.now() - (owner.acquiredAt ?? owner.ts))}).`,
                    `No longer heartbeating: the heavy mutex becomes reclaimable in ${fmtDuration(STALE_MS)}.`,
                    "See issue #2999.",
                ].join(" ")
            );
            logEvent({
                event: "stalled",
                silent_beats: silentBeats,
                subtree_cpu_ms: cpu,
            });
            return;
        }
        try {
            writeFileSync(
                OWNER_FILE,
                JSON.stringify({ ...owner, ts: Date.now() })
            );
        } catch {
            /* lock may be mid-release — never crash the gate for this */
        }
    }, HEARTBEAT_MS);
    hb.unref(); // the timer must never keep the process alive
}

async function main() {
    const nested = process.env.TOLARIA_GATE_HELD === "1";
    if (tier === "heavy" && !nested) {
        await acquire();
        startHeartbeat();
        process.on("exit", release);
        for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
            process.on(sig, () => {
                release();
                process.exit(130);
            });
        }
    }

    const env = {
        ...process.env,
        TOLARIA_GATE_HELD:
            tier === "heavy" ? "1" : process.env.TOLARIA_GATE_HELD,
        TOLARIA_VITEST_WORKERS:
            process.env.TOLARIA_VITEST_WORKERS ??
            (tier === "heavy" ? String(HEAVY_WORKERS) : undefined),
    } as NodeJS.ProcessEnv;

    const child = spawn("sh", ["-c", command], { stdio: "inherit", env });
    child.on("exit", (code, signal) => {
        release();
        process.exit(signal ? 128 : (code ?? 1));
    });
}

void main();
