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
 *           mutex and get the full worker count, CAPPED (see below). One at a
 *           time, but each runs at solo speed instead of N running at 1/N
 *           speed. Callers queue.
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
 *   TOLARIA_HEAVY_WORKERS_CAP  ceiling on the heavy tier's worker count
 *                              (default 4) — RAM-bound, see HEAVY_WORKERS
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
import {
    INITIAL_HEARTBEAT,
    SubtreeProgress,
    heartbeatStep,
    reclaimVerdict,
    subtreeFromPs,
} from "./lib/gate-liveness";

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
/**
 * Ceiling on the heavy tier's worker count. The cap is RAM-bound, not
 * CPU-bound (issue #3123).
 *
 * Measured 2026-09-07 on this machine (16 GB, 8 cores, ~11 GB baseline from
 * the editor/browser/agent sessions): `ncpu - 1` = 7 vitest workers at ~0.9 GB
 * resident each, plus `tsc -b` at ~2 GB, is ~8 GB of demand on top of that
 * baseline — 5.5 GB of swap and 1.2M pageouts. Paging, not scheduling, was
 * then the wall: workers stall on faults, tests blow their ceilings, and the
 * run reds on correct code. At 4 workers the same suites peak around 5 GB with
 * no swap, and `test:app` wall time rises only ~25% — a cheap price for a
 * result that is not a coin flip.
 *
 * Raise it on a machine with more RAM: TOLARIA_HEAVY_WORKERS_CAP=7.
 */
const HEAVY_WORKERS_CAP = Number(process.env.TOLARIA_HEAVY_WORKERS_CAP ?? 4);
/** Heavy-tier worker count — one core left for the OS, then RAM-capped. */
const HEAVY_WORKERS = Math.max(2, Math.min(NCPU - 1, HEAVY_WORKERS_CAP));

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

/**
 * CPU time of each LIVE descendant of `pid`, in ms, keyed by pid — the cheapest
 * signal that a held subtree is doing work, and one that needs no cooperation
 * from the wrapped command. The parsing (and why the gate process and `ps`
 * itself are excluded) is `subtreeFromPs` in `scripts/lib/gate-liveness.ts`.
 *
 * Returns null when the measurement is unavailable (no `ps`, unparseable
 * output). Callers must treat null as "unknown" and keep the holder, never as
 * "stalled": reclaiming a healthy holder is the worse failure.
 */
function subtreeCpu(pid: number): Map<number, number> | null {
    const r = spawnSync("ps", ["-Ao", "pid=,ppid=,time="], {
        encoding: "utf8",
    });
    if (r.status !== 0 || !r.stdout) return null;
    return subtreeFromPs(r.stdout, pid, r.pid);
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
            const waitedMs = Date.now() - t0;
            // Close the wait the retry lines opened (issue #3487): without it
            // a terminal whose last line is "waiting …" still reads as queued
            // once the command is running under the lock.
            if (announcedFor !== null)
                console.error(
                    `[gate] acquired the heavy mutex after ${fmtDuration(waitedMs)}`
                );
            logWait(waitedMs);
            return;
        }
        const owner = readOwner();
        const now = Date.now();
        // Prune a lock whose holder died, or one that stopped attesting to
        // progress. The two are different failures and read differently:
        // an absent pid is an orphan, a live pid that went silent is a HUNG
        // holder (issue #2999) and the command it wrapped is still running.
        const verdict = reclaimVerdict(
            owner,
            !!owner && alive(owner.pid),
            now,
            STALE_MS
        );
        // `!owner` is already "dead" — restated so the narrowing below holds.
        if (verdict || !owner) {
            const dead = verdict !== "stalled" || !owner;
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
    const cpu = new SubtreeProgress().observe(subtreeCpu(owner.pid));
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
    const progress = new SubtreeProgress();
    let state = INITIAL_HEARTBEAT;
    const hb = setInterval(() => {
        if (state.stalled) return;
        const owner = readOwner();
        if (!owner || owner.pid !== process.pid) return; // not ours
        const cpu = progress.observe(subtreeCpu(process.pid));
        // The decision — including "unmeasurable counts as progress" — is
        // `heartbeatStep` (scripts/lib/gate-liveness.ts), tested pure.
        const step = heartbeatStep(state, cpu, STALL_BEATS);
        state = step.state;
        if (step.verdict === "stalled") {
            console.error(
                [
                    `[gate] STALLED — the held subtree has burned no CPU for ${state.silentBeats} beats`,
                    `(${((cpu ?? 0) / 1000).toFixed(2)}s total, held ${fmtDuration(Date.now() - (owner.acquiredAt ?? owner.ts))}).`,
                    `No longer heartbeating: the heavy mutex becomes reclaimable in ${fmtDuration(STALE_MS)}.`,
                    "See issue #2999.",
                ].join(" ")
            );
            logEvent({
                event: "stalled",
                silent_beats: state.silentBeats,
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

/**
 * The wrapped command's process tree, killable as ONE unit.
 *
 * `child` is only ever the `sh` wrapper; the CPU lives in its descendants —
 * vitest and its worker pool, `tsc -b`, eslint. `child.kill()` reaches `sh`
 * alone and leaves every one of them running, reparented to PID 1, where
 * nothing reclaims them: `gate:who` (issue #2999) reclaims the LOCK from a
 * dead holder, never the processes. Measured on issue #3821, a targeted
 * SIGTERM to the gate left three descendants of a single `sh` alive; the same
 * shape, from other tooling, held this machine at load average 181 with ~600%
 * of the CPU burned by sessions that had already exited.
 *
 * So the child is spawned `detached`, making it the leader of its own process
 * group, and every teardown path signals the GROUP (`-pid`). The group id
 * survives reparenting, which is exactly why it is the only handle that still
 * works once the parent is gone. Playwright solves the identical problem the
 * identical way for the browser it launches (`detached` + `process.kill(-pid)`,
 * see `node_modules/playwright-core`), which is why an interrupted `check:ui`
 * leaves no orphan Chromium.
 */
let child: ReturnType<typeof spawn> | undefined;

/**
 * Signal the child's whole process group. Idempotent: a throw means the group
 * is already gone (ESRCH), which is the outcome we wanted anyway.
 */
function killChildTree(signal: NodeJS.Signals) {
    const pid = child?.pid;
    if (pid === undefined) return;
    try {
        process.kill(-pid, signal);
    } catch {
        /* already reaped */
    }
}

/**
 * Teardown for every path out of this process: the wrapped tree dies, then —
 * for the tier that took it — the mutex is freed. That ORDER is load-bearing.
 * The reverse hands the lock to a waiter while the outgoing holder's workers
 * are still saturating the CPU the mutex exists to ration.
 *
 * WHEN this is installed is load-bearing too, and the two tiers differ:
 *
 *   heavy — only once `acquire()` has RETURNED, exactly where the release-only
 *           handlers used to go. A gate still queuing for the mutex must keep
 *           dying by the signal itself: `land.test.ts` reads `r.signal ===
 *           "SIGTERM"` as the proof that the call was genuinely blocked in the
 *           poll loop rather than merely slow, and an early handler turns that
 *           into a clean `exit(130)` that proves nothing. Nothing is lost by
 *           waiting — before `acquire()` returns there is no child to reap and
 *           no lock of ours to free.
 *   light / nested — after the spawn, because there is no lock to guard and
 *           nothing to install before the child exists.
 *
 * For the non-holding tiers these handlers are new, and they are not optional:
 * detaching the child removed it from the terminal's foreground process group,
 * so a Ctrl-C no longer reaches it on its own and the gate is now the only
 * route a signal has to the command it wraps.
 */
function installTeardown(holdsLock: boolean) {
    process.on("exit", () => {
        killChildTree("SIGKILL");
        if (holdsLock) release();
    });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => {
            killChildTree(sig);
            if (holdsLock) release();
            process.exit(130);
        });
    }
}

async function main() {
    const nested = process.env.TOLARIA_GATE_HELD === "1";
    const holdsLock = tier === "heavy" && !nested;
    if (holdsLock) {
        await acquire();
        startHeartbeat();
        installTeardown(true);
    }

    const env = {
        ...process.env,
        TOLARIA_GATE_HELD:
            tier === "heavy" ? "1" : process.env.TOLARIA_GATE_HELD,
        TOLARIA_VITEST_WORKERS:
            process.env.TOLARIA_VITEST_WORKERS ??
            (tier === "heavy" ? String(HEAVY_WORKERS) : undefined),
    } as NodeJS.ProcessEnv;

    child = spawn("sh", ["-c", command], {
        stdio: "inherit",
        env,
        detached: true,
    });
    if (!holdsLock) installTeardown(false);
    child.on("exit", (code, signal) => {
        if (holdsLock) release();
        process.exit(signal ? 128 : (code ?? 1));
    });
}

void main();
