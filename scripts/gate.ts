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
 * MODEL. Two tiers, the heavier of which has two acquisitions:
 *
 *   heavy — the full suites and `check:all`. Hold a machine-wide exclusive
 *           mutex and get the full worker count, CAPPED (see below). One at a
 *           time, but each runs at solo speed instead of N running at 1/N
 *           speed. Callers queue.
 *   yield — heavy, queued in the `health` class. See ORDER below.
 *   job   — heavy, for the long CPU-bound JOBS an issue session legitimately
 *           runs itself: the Oracle compiler's Bot-play sweep (it re-execs
 *           itself here only when it will play — `lib/heavy-admission.ts`; its
 *           drift-guard and carry-forward modes stay unadmitted),
 *           `verdicts:search` and `bot:reach`. Same mutex, same worker count,
 *           same heartbeat — but NOT refused in an issue worktree, because the
 *           guard below exists to stop a session re-paying the merge-train's
 *           gate, and these are not that gate: they are the work itself (a
 *           grammar slice recompiles, a bot slice searches verdicts). Issue
 *           #4941 measured them running outside the mutex entirely — a sweep
 *           averaging 28 min beside a `land` and two `check:ui` pools put the
 *           load at 20–38.
 *   light — targeted vitest, `check:ts`, `lint`. No lock, but vitest is capped
 *           at TOLARIA_VITEST_WORKERS (default 2, see vitest.config.ts), so
 *           four concurrent light jobs fit in ncpu.
 *
 * `check:ui` is NOT a tier here. It keeps its own browser lane
 * (`lib/ui-admission.ts`) so a browser run never blocks a `land` — and it
 * counts against heavy admission from its side only: when it sizes its pool
 * it asks `heavyHolderLive` whether a heavy holder (any of the three spellings
 * above) is live, and if one is it walks ONE viewport at a time instead of
 * starting a Chrome pool (`viewportParallelism`, issue #4941). A heavy gate
 * never waits for `check:ui`.
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
 * stops the refresh and stamps `stalledAt`; STALLED_RECLAIM_MS (5 min) later
 * the head of the queue kills the hung subtree and takes the lock (issue
 * #4965 — it used to be the 45 min of STALE_MS, with the hung workers left
 * running under the next holder). A subtree that burns CPU again before then
 * withdraws the declaration. STALE_MS stays for the holder that cannot even
 * declare: a gate process that is itself frozen. Both thresholds are
 * wall-clock, so a waiter that was itself not running — a slept machine —
 * judges no stall until it has polled a full beat (`stallJudgeable`).
 *
 * ORDER (issue #4965). The mutex is a `mkdir` lock every waiter polls, and a
 * polled lock has no order: whoever polls first after a release wins. PR
 * #4956 — one test file — waited 24m22s behind two lands and a health run
 * that arrived in arbitrary order; over 14 days 93 lands queued 10.6 h in
 * total. So every waiter records itself under `gate.waiters/` (pid, role,
 * tier, `since`, and `seen`, restamped on every poll) and ONLY THE HEAD of
 * that queue may take or reclaim the lock. The head is the live waiter with
 * the best (class, since): `land` > `job` > heavy (hand-run) > `health`, the
 * class rising one step per AGE_STEP_MS (30 min) queued so health cannot
 * starve. Every waiter computes the same order from the same registry —
 * `admissionOrder` in `lib/gate-liveness.ts`, tested pure — so there is no
 * coordinator, and a head that stops polling drops out of everyone's view
 * after WAITER_STALE_MS. `yield` is the health gate's historical spelling of
 * the heavy tier: same mutex, same worker count, same heartbeat, queued in
 * the `health` class (ADR 0136 §6 — it used to step aside for queued lands
 * until a 30 min bound and then compete as an equal, which on 2026-10-02 let
 * three health waiters past their bound each take a full gate in turn while
 * two lands waited 25–35 min).
 *
 * TEARDOWN (issue #4965). Before the lock is released every descendant of
 * the wrapped command is dead, and that is verified — see `killTree`.
 *
 * MACHINE (issue #4966). The mutex rations the gates among themselves; it
 * never looked at the machine. A heavy acquisition (all three spellings) now
 * asks `lib/machine-admission.ts` once it HOLDS the mutex and before it
 * spawns: on a saturated machine (1-min load over `machine.loadMax`, or the
 * kernel reporting memory pressure) it waits, printing
 * `[gate] machine busy — load L, swap S`, bounded by `machine.waitMaxS`; past
 * the bound it exits `MACHINE_SATURATED_EXIT` having run nothing — `infra`,
 * never a red lane. It waits UNDER the hold on purpose: a saturated machine
 * is saturated for every waiter, and the queue's order is kept. A nested call
 * runs inside a hold that already asked, and the light tier adds two workers
 * to whatever is there — neither asks. The callers that ask with NO hold
 * (`land`'s preflight, `check:ui`, a `health-main` run outside one) do not
 * wait on the load of a holder whose command is running — `childPid` on the
 * owner stamp is how they tell it from one still waiting here (issue #4988).
 * Every run, of every tier, records the
 * load and swap it started and ended on in `gate-lock.jsonl` (`event: "run"`),
 * so a verdict can be read beside the machine it was reached on.
 *
 * Usage:
 *   bun scripts/gate.ts heavy '<shell command>'
 *   bun scripts/gate.ts yield '<shell command>'   # heavy, in the health class
 *   bun scripts/gate.ts job '<shell command>'     # heavy, allowed in a worktree
 *   bun scripts/gate.ts light '<shell command>'
 *   bun scripts/gate.ts who              # the holder, and the queue in order
 *
 * Env:
 *   TOLARIA_GATE_HELD=1        set by this script for the child; a nested heavy
 *                              call passes straight through (no self-deadlock)
 *   TOLARIA_GATE_ROLE          what this caller is — `land`, `health`, or
 *                              unset; recorded on the waiter entry and read by
 *                              the admission order
 *   TOLARIA_ALLOW_FULL_SUITE=1 escape hatch for the issue-worktree guard
 *   TOLARIA_VITEST_WORKERS     worker cap read by vitest.config.ts
 *   TOLARIA_VITEST_FS_CACHE    forced to "0" for the child on EVERY tier: no
 *                              gate touches vitest's module cache, which is
 *                              on for a bare targeted run (issue #4614)
 *   TOLARIA_HEAVY_WORKERS_CAP  ceiling on the heavy tier's worker count
 *                              (default 4) — RAM-bound, see HEAVY_WORKERS
 *   TOLARIA_GATE_SATURATED_OK=1  start on a saturated machine anyway —
 *                              announced on the gate's own line and logged.
 *                              NOT the session's `TOLARIA_OVER_CAP`: a session
 *                              started past the cap passes that one to every
 *                              gate it runs, and they must still wait
 *   TOLARIA_MACHINE_PROBE      a JSON machine sample read instead of the
 *                              machine (tests only); such a run logs no
 *                              `run` row
 *   TOLARIA_MACHINE_WAIT_MAX_MS / TOLARIA_MACHINE_POLL_MS  the machine wait's
 *                              bound and poll period (tests only)
 *   TOLARIA_GATE_LOCK_ROOT     lock location override (tests only)
 *   TOLARIA_GATE_HEARTBEAT_MS  owner-stamp refresh period override (tests only)
 *   TOLARIA_GATE_STALE_MS      staleness threshold override (tests only)
 *   TOLARIA_GATE_STALL_BEATS   no-progress beats before a holder stops
 *                              heartbeating (tests only)
 *   TOLARIA_GATE_STALLED_RECLAIM_MS  declared stall → reclaimable (tests only)
 *   TOLARIA_GATE_AGE_STEP_MS   queued time per class of ageing (tests only)
 *   TOLARIA_GATE_WAITER_STALE_MS  a waiter silent this long is not queued
 *                              (tests only)
 *   TOLARIA_GATE_WAITER_SINCE  this waiter's queue-entry time, epoch ms, when
 *                              it is not the moment it registers: `land`
 *                              passes the time it was issued (issue #4988);
 *                              also the injected clock of the ageing tests.
 *                              Never handed on to the command
 *   TOLARIA_GATE_KILL_GRACE_MS TERM → KILL grace of a teardown (tests only)
 *   TOLARIA_GATE_POLL_MS       a waiter's poll period (tests only)
 *   TOLARIA_GATE_OWNERLESS_GRACE_MS  how old a lock with no owner must be
 *                              before it is an orphan (tests only)
 */
import { spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    rmSync,
    readFileSync,
    statSync,
    writeFileSync,
    appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, cpus } from "node:os";
import {
    AGE_STEP_MS,
    INITIAL_HEARTBEAT,
    POLL_GAP_FACTOR,
    STALLED_RECLAIM_MS,
    SubtreeProgress,
    TrackedTree,
    admissionOrder,
    describeClass,
    heartbeatStep,
    parsePsRows,
    survivorLines,
    pollGap,
    WAITER_SINCE_ENV,
    reclaimVerdict,
    reclaimableInMs,
    stallJudgeable,
    subtreeFromPs,
    waiterLive,
    waiterSince,
    type GateWaiter,
    type PsRow,
} from "./lib/gate-liveness";
import { gateChildEnv } from "./lib/vitest-fs-cache";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    MACHINE_SATURATED_EXIT,
    probeInjected,
    readMachineConfig,
    readMachineSample,
    waitForMachine,
    type MachineSample,
} from "./lib/machine-admission";
import { uiLaneWhoLines } from "./lib/ui-admission";

// Overridable so the test suite can exercise the mutex against a temp dir
// instead of contending with (or blocking) a real gate run on this machine.
const LOCK_ROOT =
    process.env.TOLARIA_GATE_LOCK_ROOT ?? join(homedir(), ".cache", "tolaria");
const LOCK_DIR = join(LOCK_ROOT, "gate.lock");
const OWNER_FILE = join(LOCK_DIR, "owner.json");
/** One file per process currently QUEUED on the mutex — beside the lock, not
 *  inside it, because the lock directory IS the lock and is removed whole on
 *  release. This registry IS the queue: the admission order is computed from
 *  it, by every waiter, on every poll. */
const WAITERS_DIR = join(LOCK_ROOT, "gate.waiters");
/** What this caller is, for the admission order. `land` sets it in
 *  `lockedEnv`, the batch health gate in `health-cadence.ts`; everything else
 *  is "". */
const ROLE = process.env.TOLARIA_GATE_ROLE ?? "";
/** Queued time per class of ageing — `AGE_STEP_MS` in `lib/gate-liveness.ts`
 *  carries the arithmetic. Overridable so the suite drives it in ms. */
const AGE_MS = Number(process.env.TOLARIA_GATE_AGE_STEP_MS ?? AGE_STEP_MS);
/** A waiter that has not polled for this long is not in the queue, whatever
 *  its pid says. A waiter polls every POLL_MS; a minute of silence is thirty
 *  missed polls — a stopped or hung process, or a dead one whose pid was
 *  reused — and it is the longest a head that will never acquire can hold
 *  everyone behind it. */
const WAITER_STALE_MS = Number(
    process.env.TOLARIA_GATE_WAITER_STALE_MS ?? 60 * 1000
);
/** Declared stall → reclaimable. `STALLED_RECLAIM_MS` carries the derivation;
 *  overridable so the suite reaches the reclaim in ms. */
const STALLED_MS = Number(
    process.env.TOLARIA_GATE_STALLED_RECLAIM_MS ?? STALLED_RECLAIM_MS
);
/** How long a teardown lets the wrapped tree act on the signal it was sent
 *  before SIGKILL, and how long it then waits to SEE the tree gone. Both are
 *  bounds on a foreground wait inside a signal handler, and together they
 *  stay well under the 10 s `gate-run.sh` gives a run between its own TERM
 *  and KILL — a gate killed mid-teardown is exactly the orphan this exists
 *  to prevent. */
const KILL_GRACE_MS = Number(process.env.TOLARIA_GATE_KILL_GRACE_MS ?? 2000);
const KILL_VERIFY_MS = 3000;
/** A lock directory with no `owner.json` is a gate caught between its
 *  `mkdir` and its owner stamp — or between the two halves of a release —
 *  for as long as it is YOUNGER than this, and an orphan only after. The
 *  window it covers is microseconds wide; five seconds is the margin for a
 *  machine at load 180. */
const OWNERLESS_GRACE_MS = Number(
    process.env.TOLARIA_GATE_OWNERLESS_GRACE_MS ?? 5000
);
const TEARDOWN_POLL_MS = 50;
/** A lock whose owner stamp is older than this is assumed orphaned even if its
 *  pid still exists. `ts` is a HEARTBEAT, not the acquisition time: the holder
 *  refreshes it every HEARTBEAT_MS for as long as its subtree keeps making
 *  progress (issue #1924 — a ladder run legitimately holds for hours), so only
 *  a holder that stopped heartbeating for 45 min is pruned. A holder that
 *  DECLARED its stall is reclaimed far sooner (STALLED_MS); this is what is
 *  left for the one that cannot declare. Dead-pid pruning is unchanged and
 *  remains the primary path.
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
/** How often a waiter looks at the queue and the lock. Overridable so the
 *  suite's queue tests take poll rounds in ms, not in seconds. */
const POLL_MS = Number(process.env.TOLARIA_GATE_POLL_MS ?? 2000);
/** After a waiter notices it had not been running, how long it polls before
 *  it acts on a `stalled` verdict again: one full beat of the holder, plus
 *  the gap threshold itself. See `stallJudgeable`. */
const SETTLE_MS = HEARTBEAT_MS + POLL_GAP_FACTOR * POLL_MS;
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
    /** When the holder's heartbeat declared its subtree stalled. Written once;
     *  STALLED_MS later the head of the queue may reclaim. */
    stalledAt?: number;
    /** The wrapped command's pid — the root a reclaimer walks to kill a
     *  stalled subtree. Absent until the command is spawned, and on a lock
     *  written by an older gate: no root, no kill, the lock alone is taken. */
    childPid?: number;
}

/** Whole or absent, never torn: a stamp rewritten in place is, for an
 *  instant, an empty file, and an unreadable owner reads as a DEAD holder —
 *  one poll landing in that instant would reclaim a healthy gate's lock. */
function writeJsonAtomic(file: string, value: unknown) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
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
/**
 * The cwd of every probe this process spawns AFTER its command started
 * (issue #4974). `land` deletes its own worktree when it merges, and that
 * worktree is this process's cwd: Bun cannot spawn from a cwd that no longer
 * exists (`posix_spawn 'ps'` → ENOENT), so without this every `ps` past the
 * removal failed — the teardown fell back to its blind group signal and the
 * heartbeat read "unmeasurable", which never stalls. None of these probes
 * reads its cwd.
 */
const SPAWN_CWD = "/";

function subtreeCpu(pid: number): Map<number, number> | null {
    const r = spawnSync("ps", ["-Ao", "pid=,ppid=,time="], {
        encoding: "utf8",
        cwd: SPAWN_CWD,
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

/**
 * Atomic: `mkdir` fails if the directory exists — empty or not, which is why
 * it is the arbiter rather than a rename of a staged directory (`rename(2)`
 * REPLACES an empty target, and a lock is briefly empty in the middle of
 * every release, and of every acquisition by a gate that predates this one).
 * The owner stamp follows, written whole; the instant between the two is
 * what OWNERLESS_GRACE_MS is for. Returns true when acquired.
 */
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
    try {
        writeJsonAtomic(OWNER_FILE, owner);
    } catch {
        // The directory was taken from under us (a gate that predates the
        // grace reclaimed it as ownerless): it is not ours, leave it alone.
        return false;
    }
    return true;
}

/** Age of the lock directory, or null when there is none. */
function lockAgeMs(now: number): number | null {
    try {
        return now - statSync(LOCK_DIR).mtimeMs;
    } catch {
        return null;
    }
}

// ── waiter registry — the queue ─────────────────────────────────────────────
// A queued gate is invisible from outside its own terminal: `owner.json` names
// the HOLDER and nothing named the queue. Every heavy-tier caller writes one
// small file while it waits, restamps it on every poll, and removes it the
// moment it acquires. A registry that cannot be written degrades ordered
// admission to the unordered poll it replaced, which is the safe direction:
// every waiter still sees ITSELF, so nobody waits on an entry it cannot read.

function waiterFile(pid: number = process.pid): string {
    return join(WAITERS_DIR, `${pid}.json`);
}

/** This process's own queue entry. Held in memory and counted from there:
 *  what a waiter knows about itself must never depend on reading back a file
 *  another gate may have pruned. */
let myEntry: GateWaiter | null = null;

function registerWaiter(): GateWaiter {
    const now = Date.now();
    myEntry = {
        pid: process.pid,
        role: ROLE,
        tier,
        label: command.slice(0, 120),
        cwd: process.cwd(),
        // The caller's own entry time when it names one (`waiterSince`): a
        // land's place dates from when it was issued, not from the end of
        // its preflight (issue #4988).
        since: waiterSince(process.env, now),
        seen: now,
    };
    stampWaiter(now);
    return myEntry;
}

/** Restamp `seen` — this waiter's liveness in everyone else's view. */
function stampWaiter(now: number) {
    if (!myEntry) return;
    myEntry.seen = now;
    try {
        mkdirSync(WAITERS_DIR, { recursive: true });
        writeJsonAtomic(waiterFile(), myEntry);
    } catch {
        /* see the header: an unwritable registry only loses the order */
    }
}

function unregisterWaiter() {
    myEntry = null;
    try {
        rmSync(waiterFile(), { force: true });
    } catch {
        /* best effort */
    }
}

/** Every OTHER waiter still queued (`waiterLive`). Entries that are not are
 *  pruned as they are read — a session killed mid-queue must not hold a place
 *  in a queue it is no longer in. */
function liveWaiters(now: number = Date.now()): GateWaiter[] {
    let names: string[];
    try {
        names = readdirSync(WAITERS_DIR);
    } catch {
        return [];
    }
    const out: GateWaiter[] = [];
    for (const name of names) {
        const file = join(WAITERS_DIR, name);
        if (!name.endsWith(".json")) {
            // A stamp mid-rename — or what a gate killed mid-write left.
            const writer = /\.json\.(\d+)\.tmp$/.exec(name);
            if (writer && !alive(Number(writer[1])))
                rmSync(file, { force: true });
            continue;
        }
        let entry: GateWaiter;
        try {
            entry = JSON.parse(readFileSync(file, "utf8")) as GateWaiter;
        } catch {
            continue; // foreign file — never a verdict
        }
        if (typeof entry.pid !== "number" || entry.pid === process.pid)
            continue;
        if (!waiterLive(entry, alive(entry.pid), now, WAITER_STALE_MS)) {
            try {
                rmSync(file, { force: true });
            } catch {
                /* another waiter pruned it first */
            }
            continue;
        }
        out.push(entry);
    }
    return out;
}

/** The queue in acquisition order — this process included while it waits. */
function queueOrder(now: number = Date.now()): GateWaiter[] {
    const others = liveWaiters(now);
    return admissionOrder(myEntry ? [myEntry, ...others] : others, now, AGE_MS);
}

function waiterLine(w: GateWaiter, now: number): string {
    return `pid ${w.pid} [${describeClass(w, now, AGE_MS)}] · waiting ${fmtDuration(now - w.since)} · ${w.cwd} · ${w.label}`;
}

/** Only ever our own lock. An unreadable owner is NOT ours: the reclaimer
 *  that killed this holder's stalled subtree takes the lock at the very
 *  moment the holder's child dies and this runs. */
function release() {
    if (readOwner()?.pid !== process.pid) return;
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
}

/**
 * Where this gate's telemetry goes, resolved ONCE and before the command
 * runs: the session's project directory, else the primary checkout of the
 * cwd. `land`'s locked command REMOVES the worktree it runs in, so a root
 * read from the cwd at the END of the run — when the `run` row is written —
 * is a directory that no longer exists: `mkdir -p` recreated
 * `../tolaria-issue-N/.claude/telemetry/` after every landing, and the row of
 * the lane gate never reached the file the thresholds are re-derived from
 * (issue #4984).
 */
let resolvedTelemetryRoot: string | undefined;
function telemetryRoot(): string {
    resolvedTelemetryRoot ??=
        process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout(GATE_CWD);
    return resolvedTelemetryRoot;
}

/** Read at load, for the same reason: asked again once the cwd is gone,
 *  `process.cwd()` is the runtime's to answer or to throw on. */
const GATE_CWD = process.cwd();

/** Telemetry: how long callers actually queue, so the tier split can be tuned,
 *  and every reclaim, so a lock freed because its holder went silent is
 *  distinguishable in a log from one released normally (which logs nothing). */
function logEvent(entry: Record<string, unknown>) {
    const root = telemetryRoot();
    const dir = join(root, ".claude", "telemetry");
    try {
        // Never resurrect a root that is gone: a scratch checkout deleted
        // under the run takes its telemetry with it, not a stray directory.
        if (!existsSync(root)) return;
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, "gate-lock.jsonl"),
            JSON.stringify({
                ts: Math.floor(Date.now() / 1000),
                tier,
                cwd: GATE_CWD,
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
    let announced = "";
    let lastAnnounce = 0;
    let waited = false;
    let lastPollAt = t0;
    /** When this waiter last noticed it had not been running. */
    let resumedAt: number | null = null;
    const pause = () =>
        // Jittered, so waiters that started together do not poll together.
        new Promise((r) => setTimeout(r, POLL_MS * (1 + Math.random() / 4)));
    // Registered BEFORE the first attempt, not after the first failure: the
    // order is computed from the registry, and a waiter that has not yet
    // written its entry is one the others would step over.
    registerWaiter();
    for (;;) {
        const now = Date.now();
        if (pollGap(lastPollAt, now, POLL_MS)) {
            // The machine slept, or this process was stopped: every stamp
            // on disk is as old as the gap, this waiter's own included, and
            // none of that is evidence about anyone. Restamp, let the others
            // do the same, and judge nothing this round (`stallJudgeable`).
            console.error(
                `[gate] resumed after a ${fmtDuration(now - lastPollAt)} pause — not judging the holder or the queue on stamps that old`
            );
            resumedAt = now;
            lastPollAt = now;
            stampWaiter(now);
            await pause();
            continue;
        }
        lastPollAt = now;
        stampWaiter(now);
        const queue = queueOrder(now);
        const head = queue[0]!;
        const position = queue.findIndex((w) => w.pid === process.pid) + 1;
        // ORDER (issue #4965): only the head of the queue touches the lock —
        // to take it, and to reclaim it. Everyone else waits for the head,
        // whatever the lock's state, which is what makes the order hold
        // "regardless of poll timing": a free mutex is not an invitation.
        const isHead = head.pid === process.pid;
        if (isHead && tryAcquire()) {
            unregisterWaiter();
            const waitedMs = Date.now() - t0;
            // Close the wait the retry lines opened (issue #3487): without it
            // a terminal whose last line is "waiting …" still reads as queued
            // once the command is running under the lock.
            if (waited)
                console.error(
                    `[gate] acquired the heavy mutex after ${fmtDuration(waitedMs)}`
                );
            logWait(waitedMs);
            return;
        }
        const owner = readOwner();
        const lockAge = owner ? null : lockAgeMs(now);
        if (isHead && !owner && lockAge === null) {
            // Released between the failed attempt and this read: simply
            // free, and nothing to reclaim. One quiet poll, not a retry loop
            // — a lock root that cannot be written looks exactly like this.
            await pause();
            continue;
        }
        // A lock with no owner is a gate mid-acquire (or mid-release) until
        // it is old enough to be an orphan — never a holder to reclaim on
        // sight.
        const settling =
            !owner && lockAge !== null && lockAge < OWNERLESS_GRACE_MS;
        if (isHead && !settling) {
            // Prune a lock whose holder died, or one that stopped attesting to
            // progress. The two are different failures and read differently:
            // an absent pid is an orphan, a live pid that went silent is a
            // HUNG holder (issue #2999) and the command it wrapped is still
            // running — so it is killed before the lock changes hands.
            const verdict = reclaimVerdict(
                owner,
                !!owner && alive(owner.pid),
                now,
                STALE_MS,
                STALLED_MS
            );
            if (
                verdict === "dead" ||
                (verdict === "stalled" &&
                    stallJudgeable(resumedAt, now, SETTLE_MS))
            ) {
                reclaim(owner, verdict, now);
                continue;
            }
        }
        // Name what this waiter is waiting FOR immediately, again whenever it
        // changes, and on every retry line — a waiter that says only "still
        // waiting" tells the blocked session nothing it can act on.
        const blocker = owner
            ? `holder ${owner.pid}`
            : lockAge !== null
              ? "ownerless"
              : `head ${head.pid}`;
        if (announced !== blocker || now - lastAnnounce >= 60_000) {
            const place = `queue position ${position}/${queue.length}`;
            const what = owner
                ? `${holderLine(owner, now)} · ${place}`
                : lockAge !== null
                  ? `taken ${fmtDuration(lockAge)} ago with no owner yet · ${place}`
                  : `free, but ${place}: next is ${waiterLine(head, now)}`;
            console.error(
                `[gate] waiting ${fmtDuration(now - t0)} for the heavy mutex — ${what}`
            );
            announced = blocker;
            lastAnnounce = now;
            waited = true;
        }
        await pause();
    }
}

/**
 * Take the lock from a holder `reclaimVerdict` condemned. Called by the HEAD
 * of the queue only.
 *
 * A STALLED holder is a live gate whose command is hung and still holds its
 * workers: reclaiming the lock alone hands the machine to the next gate with
 * the previous one's processes still on it. So the subtree is killed FIRST —
 * the same tree walk a holder's own teardown uses — rooted at the `childPid`
 * the holder recorded. The root is only trusted while `ps` still shows it as
 * a child of the holder's pid: a holder pid the OS has reused carries no such
 * child, and an unrelated process's tree is never walked.
 */
function reclaim(
    owner: Owner | null,
    verdict: "dead" | "stalled",
    now: number
) {
    const dead = verdict === "dead" || !owner;
    const why = dead
        ? `holder is gone (${owner ? holderLine(owner, now) : "no readable owner"})`
        : `STALLED holder — pid ${owner.pid} is alive but has not attested to progress in ${fmtDuration(now - owner.ts)} (${holderLine(owner, now)})`;
    console.error(`[gate] reclaiming the heavy mutex — ${why}`);
    let subtree: "killed" | "survived" | "unrooted" | null = null;
    if (!dead) {
        const rows = psRows();
        const root = rows?.find((r) => r.pid === owner.childPid);
        const holder = rows?.find((r) => r.pid === owner.pid);
        if (root && holder && root.ppid === owner.pid) {
            const kill = killTree(root.pid, "SIGTERM", KILL_GRACE_MS, [
                holder.pgid,
            ]);
            subtree = kill.gone ? "killed" : "survived";
            if (kill.gone)
                console.error(
                    `[gate] killed the stalled subtree of pid ${root.pid}`
                );
            else
                warnUnconfirmed(
                    `[gate] could NOT confirm the stalled subtree of pid ${root.pid} is gone — taking the mutex anyway`,
                    kill.survivors
                );
        } else subtree = "unrooted";
    }
    logEvent({
        event: "reclaimed",
        reason: dead ? "dead" : "stalled",
        holder_pid: owner?.pid ?? null,
        holder_cwd: owner?.cwd ?? null,
        holder_label: owner?.label ?? null,
        silent_ms: owner ? now - owner.ts : null,
        subtree,
    });
    // Killing took seconds, and the holder releases by itself the moment its
    // child dies: the lock on disk may by now be a NEW holder's. Remove only
    // the one that was judged.
    const current = readOwner();
    if (
        current &&
        (current.pid !== owner?.pid || current.acquiredAt !== owner?.acquiredAt)
    )
        return;
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* the holder released it first */
    }
}

// ── tree teardown ───────────────────────────────────────────────────────────
function psRows(): PsRow[] | null {
    // `-ww`: off a terminal `ps` cuts a row at 79 columns, and the command is
    // what a survivor is diagnosed by. It costs ~20 ms a pass over the bare
    // four columns (44 ms against 24, 650 processes) — paid so that the pass
    // that convicts a survivor is the pass that names it.
    const r = spawnSync("ps", ["-ww", "-Ao", "pid=,ppid=,pgid=,stat=,args="], {
        encoding: "utf8",
        cwd: SPAWN_CWD,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0 || !r.stdout) return null;
    return parsePsRows(r.stdout);
}

/** What a teardown SAW. `survivors` is the last pass's — null when `ps` gave
 *  no pass to read them from. */
type TreeKill = { gone: true } | { gone: false; survivors: PsRow[] | null };

/** The unconfirmed-teardown warning, survivors named (issue #4976). To
 *  stderr: that is what reaches `land`'s log, where the next one is read. */
function warnUnconfirmed(headline: string, survivors: PsRow[] | null) {
    console.error([headline, ...survivorLines(survivors)].join("\n"));
}

function signalQuietly(target: number, signal: NodeJS.Signals) {
    try {
        process.kill(target, signal);
    } catch {
        /* already gone — the outcome we wanted */
    }
}

/**
 * Kill the process tree rooted at `root` — every descendant, in every process
 * group — and report whether it was SEEN to be gone (issue #4965).
 *
 * `signal` first, so a command that cleans up after itself gets to; SIGKILL
 * once `graceMs` has passed; then up to KILL_VERIFY_MS for `ps` to show
 * nothing left. Why one group is not the tree, and what is tracked instead:
 * `TrackedTree` in `lib/gate-liveness.ts`.
 *
 * SYNCHRONOUS on purpose. It runs inside signal and `exit` handlers, and the
 * caller's next statement is `release()`: the mutex must not change hands
 * while a worker of the outgoing holder is still alive, and "after an await"
 * is not a place a dying process reliably reaches.
 *
 * Not gone means unverified, not failed: `ps` unavailable, or a survivor past
 * the bound. The caller releases anyway — a holder that refused would only
 * leave a dead-pid lock for the next waiter to reclaim — and says so, naming
 * the survivors of the last pass (issue #4976).
 */
function killTree(
    root: number,
    signal: NodeJS.Signals,
    graceMs: number,
    protectedGroups: number[] = []
): TreeKill {
    let rows = psRows();
    if (!rows) {
        // No `ps`: the group of the direct child is the only handle there is.
        signalQuietly(-root, signal);
        if (signal !== "SIGKILL") {
            Bun.sleepSync(graceMs);
            signalQuietly(-root, "SIGKILL");
        }
        return { gone: false, survivors: null };
    }
    const own = rows.find((r) => r.pid === process.pid)?.pgid;
    const tree = new TrackedTree(
        root,
        new Set(own === undefined ? protectedGroups : [own, ...protectedGroups])
    );
    // Each target gets the polite signal ONCE: a second SIGTERM is, to more
    // than one tool, "stop cleaning up and die", and that is SIGKILL's job
    // here. SIGKILL itself is repeated every pass — a group can gain a member
    // between two of them.
    const sent = new Set<number>();
    const send = (target: number, sig: NodeJS.Signals) => {
        if (sig !== "SIGKILL") {
            if (sent.has(target)) return;
            sent.add(target);
        }
        signalQuietly(target, sig);
    };
    const t0 = Date.now();
    for (;;) {
        const survivors = tree.absorb(rows);
        if (survivors.length === 0) return { gone: true };
        const elapsed = Date.now() - t0;
        if (elapsed > graceMs + KILL_VERIFY_MS)
            return { gone: false, survivors };
        const sig =
            signal === "SIGKILL" || elapsed >= graceMs ? "SIGKILL" : signal;
        for (const pgid of tree.groups) send(-pgid, sig);
        // A survivor sitting in a group that is never signalled as a group
        // (the gate's own) is reached by pid.
        for (const r of survivors)
            if (!tree.groups.has(r.pgid)) send(r.pid, sig);
        Bun.sleepSync(TEARDOWN_POLL_MS);
        rows = psRows();
        if (!rows) return { gone: false, survivors: null };
    }
}

// ── `who` — the diagnosis in one command ────────────────────────────────────
function who(): number {
    const owner = readOwner();
    const now = Date.now();
    if (!owner) console.log("[gate] heavy mutex is free");
    else {
        console.log(`[gate] heavy mutex — ${holderLine(owner, now)}`);
        const live = alive(owner.pid);
        const cpu = new SubtreeProgress().observe(subtreeCpu(owner.pid));
        const reclaimIn = reclaimableInMs(owner, now, STALE_MS, STALLED_MS);
        console.log(
            `[gate]   holder pid ${live ? "alive" : "GONE"} · subtree CPU ${
                cpu === null ? "unmeasurable" : `${(cpu / 1000).toFixed(2)}s`
            } · reclaimable in ${fmtDuration(reclaimIn)}${
                owner.stalledAt === undefined
                    ? ""
                    : ` · STALLED ${fmtDuration(now - owner.stalledAt)} ago`
            }`
        );
        if (!live)
            console.log(
                "[gate]   holder is dead — the head of the queue reclaims it"
            );
        else if (reclaimIn < 0)
            console.log(
                "[gate]   holder went silent — the head of the queue kills its subtree and reclaims it"
            );
    }
    // The queue, in ACQUISITION ORDER (issue #4965): `#1` is the only waiter
    // that may take the mutex next. Printed with or without a holder — under
    // ordered admission a free mutex can still have a queue, for the two
    // seconds until its head polls.
    queueOrder(now).forEach((w, i) =>
        console.log(`[gate]   queued #${i + 1} — ${waiterLine(w, now)}`)
    );
    return 0;
}

/** The detached `gate:run` runs (issue #4940): `gate-run.sh --list` reaps the
 *  orphans first, then names every live run — key, script, cwd, age, pid — so
 *  a session sees what a "retry" under a new key would duplicate. The registry
 *  and the reaper live in the shell script alone; this only asks it. Bounded:
 *  a reap waits out a TERM grace, and a hung child must not hang `who`. */
function detachedRunLines(): string[] {
    const r = spawnSync(
        "sh",
        [join(import.meta.dir, "gate-run.sh"), "--list"],
        { encoding: "utf8", timeout: 60_000, cwd: SPAWN_CWD }
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.status !== 0 || out === "")
        return [
            `[gate] detached runs unreadable (gate-run.sh --list exit ${r.status ?? r.signal})`,
        ];
    return out.split("\n");
}

/** `who` also names the `check:ui` lane (issue #4687) — a separate mutex, so
 *  a browser run never blocks a `land`, but the same one-command diagnosis. */
function whoAll(): number {
    const code = who();
    for (const line of uiLaneWhoLines(LOCK_ROOT)) console.log(line);
    for (const line of detachedRunLines()) console.log(line);
    return code;
}

if (tier === "who") process.exit(whoAll());

/** `yield` is the heavy tier in every respect but the class it queues in (ADR
 *  0136 §6, issue #4965), `job` in every respect but its class and the
 *  issue-worktree guard (issue #4941): same mutex, same worker count, same
 *  heartbeat, same teardown. */
const HEAVY_TIERS = ["heavy", "yield", "job"] as const;
const isHeavyTier = (t: string): boolean =>
    (HEAVY_TIERS as readonly string[]).includes(t);

if ((!isHeavyTier(tier) && tier !== "light") || !command) {
    console.error(
        "usage: bun scripts/gate.ts <heavy|yield|job|light> '<shell command>' | bun scripts/gate.ts who"
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
    isHeavyTier(tier) &&
    tier !== "job" &&
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
 * refreshing and stamps `stalledAt`: STALLED_MS later the head of the queue
 * reclaims it (`reclaim`). Nothing HERE kills the wrapped command — it only
 * stops the gate vouching for it, and it keeps sampling: a subtree that burns
 * CPU again before the reclaim withdraws the declaration and keeps the mutex.
 * The reclaimer is what kills it, so that it never runs beside the next
 * holder (issue #4965).
 *
 * The first beat has no baseline to compare against, so detection costs
 * STALL_BEATS + 1 beats.
 */
function startHeartbeat() {
    const progress = new SubtreeProgress();
    let state = INITIAL_HEARTBEAT;
    const hb = setInterval(() => {
        const owner = readOwner();
        if (!owner || owner.pid !== process.pid) return; // not ours
        const cpu = progress.observe(subtreeCpu(process.pid));
        // The decision — including "unmeasurable counts as progress" — is
        // `heartbeatStep` (scripts/lib/gate-liveness.ts), tested pure.
        const step = heartbeatStep(state, cpu, STALL_BEATS);
        state = step.state;
        if (step.verdict === "latched") return; // declared, and still frozen
        if (step.verdict === "recovered") {
            // The subtree is working again and nobody has reclaimed it yet
            // (the lock is still ours, checked above): withdraw the
            // declaration before the reclaimer's five minutes run out.
            console.error(
                "[gate] RECOVERED — the held subtree is burning CPU again; heartbeating, stall withdrawn."
            );
            logEvent({ event: "recovered", subtree_cpu_ms: cpu });
            try {
                writeJsonAtomic(OWNER_FILE, {
                    ...owner,
                    ts: Date.now(),
                    stalledAt: undefined,
                });
            } catch {
                /* lock may be mid-release — never crash the gate for this */
            }
            return;
        }
        if (step.verdict === "stalled") {
            console.error(
                [
                    `[gate] STALLED — the held subtree has burned no CPU for ${state.silentBeats} beats`,
                    `(${((cpu ?? 0) / 1000).toFixed(2)}s total, held ${fmtDuration(Date.now() - (owner.acquiredAt ?? owner.ts))}).`,
                    `No longer heartbeating: in ${fmtDuration(STALLED_MS)} the head of the queue kills this subtree and takes the heavy mutex.`,
                    "See issue #2999.",
                ].join(" ")
            );
            try {
                writeJsonAtomic(OWNER_FILE, {
                    ...owner,
                    stalledAt: Date.now(),
                });
            } catch {
                /* unwritten, the STALE_MS path still reclaims — only later */
            }
            logEvent({
                event: "stalled",
                silent_beats: state.silentBeats,
                subtree_cpu_ms: cpu,
            });
            return;
        }
        try {
            writeJsonAtomic(OWNER_FILE, { ...owner, ts: Date.now() });
        } catch {
            /* lock may be mid-release — never crash the gate for this */
        }
    }, HEARTBEAT_MS);
    hb.unref(); // the timer must never keep the process alive
}

/**
 * The wrapped command's process tree, and the one handle on it.
 *
 * `child` is only ever the `sh` wrapper; the CPU lives in its descendants —
 * vitest and its worker pool, `tsc -b`, eslint. `child.kill()` reaches `sh`
 * alone and leaves every one of them running, reparented to PID 1, where
 * nothing reclaims them. Measured on issue #3821, a targeted SIGTERM to the
 * gate left three descendants of a single `sh` alive; the same shape, from
 * other tooling, held this machine at load average 181 with ~600% of the CPU
 * burned by sessions that had already exited.
 *
 * So the child is spawned `detached`, making it the leader of its own process
 * group: the group id survives reparenting, which is why it is the handle
 * that still works once a parent is gone. It is ONE handle, though, and the
 * tree is not one group — a nested gate detaches its own child the same way —
 * so teardown walks the tree and signals every group it meets (`killTree`).
 */
let child: ReturnType<typeof spawn> | undefined;

let tornDown = false;

/** Kill the wrapped tree, once. Every path out of this process comes through
 *  here before it releases; the `exit` handler's pass is the catch-all for
 *  the paths that did not. */
function teardownChild(signal: NodeJS.Signals, graceMs: number) {
    const pid = child?.pid;
    if (pid === undefined || tornDown) return;
    tornDown = true;
    const kill = killTree(pid, signal, graceMs);
    if (!kill.gone)
        warnUnconfirmed(
            `[gate] could NOT confirm the tree of pid ${pid} is gone (${signal}) — continuing`,
            kill.survivors
        );
}

/**
 * Teardown for every path out of this process: the wrapped tree dies — ALL of
 * it, seen to be gone — then, for the tier that took it, the mutex is freed.
 * That ORDER is load-bearing. The reverse hands the lock to a waiter while
 * the outgoing holder's workers are still saturating the CPU the mutex exists
 * to ration.
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
 *           no lock of ours to free; the queue entry it leaves behind stops
 *           being restamped and drops out of the order (`waiterLive`).
 *   light / nested — after the spawn, because there is no lock to guard and
 *           nothing to install before the child exists.
 *
 * For the non-holding tiers these handlers are not optional: detaching the
 * child removed it from the terminal's foreground process group, so a Ctrl-C
 * no longer reaches it on its own and the gate is the only route a signal has
 * to the command it wraps. A NESTED gate is how a signal crosses into the
 * second process group at all when the outer gate cannot walk the tree.
 */
function installTeardown(holdsLock: boolean) {
    process.on("exit", () => {
        teardownChild("SIGKILL", 0);
        unregisterWaiter();
        if (holdsLock) release();
    });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => {
            teardownChild(sig, KILL_GRACE_MS);
            unregisterWaiter();
            if (holdsLock) release();
            process.exit(130);
        });
    }
}

/** The `run` row (issue #4966): the machine this run started and ended on.
 *  A run under an injected probe measured nothing and logs nothing — the
 *  suite must not write its fixtures into the file thresholds are re-derived
 *  from. */
function logRun(start: MachineSample, startedAt: number, exit: number) {
    if (probeInjected()) return;
    const end = readMachineSample();
    logEvent({
        event: "run",
        exit,
        duration_ms: Date.now() - startedAt,
        load_start: start.load1,
        load_end: end.load1,
        swap_start_mb: start.swapUsedMb,
        swap_end_mb: end.swapUsedMb,
        pressure_start: start.pressure,
        pressure_end: end.pressure,
        reclaimable_start_mb: start.reclaimableMb,
        reclaimable_end_mb: end.reclaimableMb,
    });
}

/** Wait, under the hold, for a machine that can carry the run; exit
 *  `MACHINE_SATURATED_EXIT` when the bound passes first. See MACHINE above. */
async function admitMachine() {
    const machine = await waitForMachine({
        thresholds: readMachineConfig(),
        tag: "[gate]",
        announce: (line) => console.error(line),
        // The heartbeat has not started — there is no subtree to attest to —
        // so the wait itself keeps the owner stamp fresh: a holder silent
        // for the whole bound is one a waiter that slept and woke may judge.
        tick: restampOwner,
        // The saturated wait's peak and the consumers it named (issue #4989),
        // beside this gate's tier and command.
        record: logEvent,
    });
    if (machine.overridden || !machine.admitted)
        logEvent({
            event: machine.admitted ? "machine-override" : "machine-saturated",
            waited_ms: machine.waitedMs,
            load: machine.sample.load1,
            swap_mb: machine.sample.swapUsedMb,
            pressure: machine.sample.pressure,
            reasons: machine.reasons,
        });
    // The `exit` handler `installTeardown` put in frees the mutex.
    if (!machine.admitted) process.exit(MACHINE_SATURATED_EXIT);
    // Reclaimed during the wait (a slept machine, a stopped process): the
    // mutex is someone else's now, and spawning would be a second holder.
    if (readOwner()?.pid !== process.pid) {
        console.error(
            "[gate] lost the heavy mutex while waiting for the machine — nothing ran; re-run."
        );
        process.exit(MACHINE_SATURATED_EXIT);
    }
}

/** Refresh this holder's owner stamp; a lock that is no longer ours is left
 *  alone. */
function restampOwner() {
    const owner = readOwner();
    if (owner?.pid !== process.pid) return;
    try {
        writeJsonAtomic(OWNER_FILE, { ...owner, ts: Date.now() });
    } catch {
        /* mid-release — never crash the gate for a stamp */
    }
}

async function main() {
    const nested = process.env.TOLARIA_GATE_HELD === "1";
    const heavy = isHeavyTier(tier);
    const holdsLock = heavy && !nested;
    if (holdsLock) {
        // A NESTED call already runs under a hold: it queues for nothing.
        await acquire();
        installTeardown(true);
        // Before the heartbeat: there is no subtree to attest to yet, and
        // the wait's bound is far inside STALE_MS.
        await admitMachine();
        startHeartbeat();
    }

    const env = gateChildEnv(process.env, heavy, HEAVY_WORKERS);
    // It dates THIS gate's place in the queue. A gate the command starts
    // later — the batch health run `land` detaches — must not queue as if it
    // had waited since that land was issued.
    delete env[WAITER_SINCE_ENV];

    // While the cwd still exists — see `telemetryRoot`.
    telemetryRoot();
    const startedAt = Date.now();
    const machineAtStart = readMachineSample();
    child = spawn("sh", ["-c", command], {
        stdio: "inherit",
        env,
        detached: true,
    });
    if (holdsLock) {
        // The root a reclaimer walks, should this hold end as a stall.
        const owner = readOwner();
        if (owner?.pid === process.pid && child.pid !== undefined)
            try {
                writeJsonAtomic(OWNER_FILE, { ...owner, childPid: child.pid });
            } catch {
                /* no root recorded — a reclaim takes the lock alone */
            }
    } else installTeardown(false);
    child.on("exit", (code, signal) => {
        // The command is done; whatever it left running is not. Same order
        // as every other path: the tree, then the lock.
        teardownChild("SIGKILL", 0);
        if (holdsLock) release();
        const exit = signal ? 128 : (code ?? 1);
        logRun(machineAtStart, startedAt, exit);
        process.exit(exit);
    });
}

void main();
