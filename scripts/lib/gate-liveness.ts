/**
 * The liveness DECISIONS of the heavy-tier mutex (`scripts/gate.ts`), as pure
 * functions over hand-buildable inputs (issue #3792).
 *
 * `gate.ts` owns the side effects — spawning `ps`, the heartbeat timer, the
 * owner stamp, the reclaim itself. Everything that DECIDES lives here, so the
 * suite can assert "progress / silent / stalled" and "reclaim or wait" over
 * sample sequences instead of through a starvable subprocess: a spinning
 * burner that a loaded machine starves for three beats reads as a stall, and
 * a test that asserts the decision through real CPU time goes red for a
 * property of the machine rather than of the code.
 */

/** `ps` CPU time — `[[DD-]HH:]MM:SS[.ss]` on macOS, `[DD-]HH:MM:SS` on Linux. */
export function parseCpuMs(field: string): number | null {
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
 * CPU time of each LIVE descendant of `pid`, in ms, keyed by pid, from the
 * output of `ps -Ao pid=,ppid=,time=`.
 *
 * `pid` itself is excluded on purpose: the gate process burns essentially
 * nothing but a timer, so including it would let the heartbeat attest to its
 * own existence again — exactly the tautology issue #2999 is about. So is
 * `excludePid`, the `ps` that produced this output: it is a child of the gate,
 * lists itself, and would otherwise count its own startup CPU as the held
 * subtree's progress.
 *
 * Returns null when the output carries no parseable row — "unmeasurable",
 * which callers must never read as "stalled".
 */
export function subtreeFromPs(
    psOutput: string,
    pid: number,
    excludePid?: number
): Map<number, number> | null {
    const children = new Map<number, number[]>();
    const cpu = new Map<number, number>();
    for (const line of psOutput.split("\n")) {
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
    const subtree = new Map<number, number>();
    const queue = [...(children.get(pid) ?? [])];
    while (queue.length) {
        const next = queue.pop()!;
        if (subtree.has(next) || next === excludePid) continue;
        subtree.set(next, cpu.get(next) ?? 0);
        queue.push(...(children.get(next) ?? []));
    }
    return subtree;
}

/**
 * A MONOTONIC running total of the CPU a subtree has burned, across
 * descendants that come and go.
 *
 * The live snapshot alone is not a progress signal. Every command the mutex
 * guards reshapes its process tree as it runs: the full suite is three
 * sequential vitest invocations, each spawning and then tearing down a whole
 * worker pool, and `check:all:inner` walks a chain of separate tools. When a
 * heavy phase exits, its CPU leaves the snapshot, and a later lighter-but-still
 * working phase can spend a long time below the earlier peak. Comparing raw
 * snapshots reads that as "frozen" and falsely reclaims a healthy holder — the
 * exact failure the issue #1924 ladder case forbids.
 *
 * So a descendant's last known CPU is RETIRED into the total when it exits.
 * The result only ever rises while any descendant does work, and stops rising
 * only when the whole subtree is genuinely idle.
 */
export class SubtreeProgress {
    private retiredMs = 0;
    private live = new Map<number, number>();

    /** Fold one pid→ms snapshot in. Total CPU burned so far, or null while
     *  unmeasurable — a null snapshot leaves the accumulated state untouched. */
    observe(snapshot: Map<number, number> | null): number | null {
        if (!snapshot) return null;
        for (const [gone, ms] of this.live)
            if (!snapshot.has(gone)) this.retiredMs += ms;
        this.live = snapshot;
        let total = this.retiredMs;
        for (const ms of snapshot.values()) total += ms;
        return total;
    }
}

export interface HeartbeatState {
    /** Highest total seen so far; -1 before the first measurable sample. */
    lastCpuMs: number;
    /** Consecutive measurable beats with no rise in the total. */
    silentBeats: number;
    /** Declared stalled. Held until the total rises again (`recovered`). */
    stalled: boolean;
}

export const INITIAL_HEARTBEAT: HeartbeatState = {
    lastCpuMs: -1,
    silentBeats: 0,
    stalled: false,
};

/**
 * What one beat does. `progress` and `silent` both refresh the owner stamp —
 * a single quiet beat is not yet a verdict; `stalled` is the beat that stops
 * refreshing and declares it, `latched` every beat the declaration stands,
 * and `recovered` the beat that withdraws it: the total rose again.
 */
export type BeatVerdict =
    | "progress"
    | "silent"
    | "stalled"
    | "latched"
    | "recovered";

/**
 * One heartbeat step over (previous state, sampled total).
 *
 * Unmeasurable (`null`) counts as progress: never reclaim a holder we cannot
 * judge — reclaiming a healthy holder is the worse failure. The first
 * measurable sample has no baseline and always reads as progress, so detection
 * costs STALL_BEATS + 1 beats.
 *
 * A declared stall is WITHDRAWN by the first measured rise (issue #4965).
 * It used to latch for good, which cost a command that came back nothing
 * worse than the mutex; now that a declared stall ends with the reclaimer
 * killing the subtree, a latch would kill a run that had resumed minutes
 * earlier. Only a MEASURED rise withdraws it: "unmeasurable" is no evidence.
 */
export function heartbeatStep(
    state: HeartbeatState,
    cpuMs: number | null,
    stallBeats: number
): { state: HeartbeatState; verdict: BeatVerdict } {
    if (state.stalled) {
        if (cpuMs === null || cpuMs <= state.lastCpuMs)
            return { state, verdict: "latched" };
        return {
            state: { lastCpuMs: cpuMs, silentBeats: 0, stalled: false },
            verdict: "recovered",
        };
    }
    if (cpuMs === null || cpuMs > state.lastCpuMs)
        return {
            state: {
                lastCpuMs: cpuMs ?? state.lastCpuMs,
                silentBeats: 0,
                stalled: false,
            },
            verdict: "progress",
        };
    const silentBeats = state.silentBeats + 1;
    const stalled = silentBeats >= stallBeats;
    return {
        state: { ...state, silentBeats, stalled },
        verdict: stalled ? "stalled" : "silent",
    };
}

/** How long after a holder DECLARED its own stall the mutex becomes
 *  reclaimable (issue #4965). The declaration already cost STALL_BEATS frozen
 *  beats — ~15 min at the default period — so the 45 min of `staleMs` on top of
 *  it bought nothing but a queue: five minutes is one more beat, the margin
 *  in which a command that comes back withdraws the declaration
 *  (`recovered`). */
export const STALLED_RECLAIM_MS = 5 * 60 * 1000;

/** What a reclaim decision reads of the owner stamp. `stalledAt` is written
 *  once, by the holder's own heartbeat, on the beat that reads `stalled`. */
export interface ReclaimableOwner {
    ts: number;
    stalledAt?: number;
}

/**
 * Whether a waiter may take the lock from its current holder: a missing owner
 * or a dead pid is an orphan, a live pid that declared its stall
 * `stalledReclaimMs` ago — or whose stamp is older than `staleMs`, the holder
 * that cannot even declare — is a HUNG holder (issue #2999). Both reclaim;
 * they read differently, and only the second has a subtree left to kill.
 */
export function reclaimVerdict(
    owner: ReclaimableOwner | null,
    holderAlive: boolean,
    now: number,
    staleMs: number,
    stalledReclaimMs: number = STALLED_RECLAIM_MS
): "dead" | "stalled" | null {
    if (!owner || !holderAlive) return "dead";
    return reclaimableInMs(owner, now, staleMs, stalledReclaimMs) < 0
        ? "stalled"
        : null;
}

/** Ms until a LIVE holder becomes reclaimable; negative once it is. The one
 *  place the two thresholds are combined — `gate:who` prints it, the reclaim
 *  verdict above branches on its sign. */
export function reclaimableInMs(
    owner: ReclaimableOwner,
    now: number,
    staleMs: number,
    stalledReclaimMs: number = STALLED_RECLAIM_MS
): number {
    const silent = owner.ts + staleMs - now;
    if (typeof owner.stalledAt !== "number") return silent;
    return Math.min(silent, owner.stalledAt + stalledReclaimMs - now);
}

/**
 * A waiter polls every `pollMs`. A gap this many periods long between two of
 * its own polls means the waiter DID NOT RUN — the machine slept, or the
 * process was stopped — and so, quite possibly, neither did anything else.
 */
export const POLL_GAP_FACTOR = 15;

export function pollGap(
    previousPollAt: number,
    now: number,
    pollMs: number
): boolean {
    return now - previousPollAt > POLL_GAP_FACTOR * pollMs;
}

/**
 * Whether a waiter may act on a `stalled` verdict (issue #4965).
 *
 * Every threshold a stall is judged by is WALL-CLOCK, and wall-clock time
 * runs while the machine sleeps: a lid closed for an hour makes a healthy
 * holder's stamp an hour old, and on wake the waiter's overdue poll and the
 * holder's overdue heartbeat fire in no particular order. When the verdict
 * only cost the lock that was a double hold; now that it kills the subtree
 * it would be a healthy `land` or health run killed by a nap. So a waiter
 * that noticed a gap in its own polling (`pollGap`) judges no stall until it
 * has polled without one for `settleMs` — a full beat of the holder, which
 * is all a live holder needs to restamp, or to withdraw a declaration.
 *
 * A DEAD holder is not a wall-clock judgment and is never deferred.
 */
export function stallJudgeable(
    resumedAt: number | null,
    now: number,
    settleMs: number
): boolean {
    return resumedAt === null || now - resumedAt >= settleMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDERED ADMISSION (issue #4965; replaces the `yield` bound of issue #3780)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One process queued on the heavy mutex, as `gate.ts` records it while it
 * waits. `role` is `TOLARIA_GATE_ROLE`: `land` for a landing, `health` for the
 * batch gate, `""` for every ordinary heavy gate.
 */
export interface GateWaiter {
    pid: number;
    role: string;
    /** The tier the waiter was invoked under — `heavy`, `yield` or `job`.
     *  Optional: an entry written by an older gate carries none. */
    tier?: string;
    label: string;
    cwd: string;
    /** Epoch ms — when this waiter entered the queue. */
    since: number;
    /** Epoch ms — the waiter's last poll. Its liveness, see `waiterLive`. */
    seen?: number;
}

/** The role a landing queues under. */
export const LAND_ROLE = "land";
/** The role the per-batch health gate queues under. */
export const HEALTH_ROLE = "health";

/**
 * The admission classes, BEST FIRST. A landing holds the mutex ~4 min and is
 * what a session is blocked on; a job is a session's own long work; a hand-run
 * heavy gate is a human or a release; the batch health gate holds ~10 min and
 * the tip it is about does not get staler while anything else runs.
 */
export const ADMISSION_CLASSES = ["land", "job", "heavy", "health"] as const;
export type AdmissionClass = (typeof ADMISSION_CLASSES)[number];

/** One class of ageing: a waiter rises one class per this much queued. Health
 *  starts three classes under a land, so it competes as a land's equal after
 *  90 min — and then wins on `since`, being older than every land still
 *  queued. That is the whole starvation bound; nothing else is needed. */
export const AGE_STEP_MS = 30 * 60 * 1000;

/** The class a waiter was BORN in. Role first: a land is a land whatever tier
 *  spelled it; `yield` is the health gate's historical spelling and still
 *  means "health class". */
export function admissionClass(w: Pick<GateWaiter, "role" | "tier">): number {
    const name: AdmissionClass =
        w.role === LAND_ROLE
            ? "land"
            : w.role === HEALTH_ROLE || w.tier === "yield"
              ? "health"
              : w.tier === "job"
                ? "job"
                : "heavy";
    return ADMISSION_CLASSES.indexOf(name);
}

/** The class a waiter competes in NOW: its own, raised one per `ageStepMs`
 *  queued, never past the best. */
export function agedClass(
    w: Pick<GateWaiter, "role" | "tier" | "since">,
    now: number,
    ageStepMs: number = AGE_STEP_MS
): number {
    const steps =
        ageStepMs > 0 ? Math.floor(Math.max(0, now - w.since) / ageStepMs) : 0;
    return Math.max(0, admissionClass(w) - steps);
}

/**
 * The queue in ACQUISITION ORDER: best aged class, then longest queued, then
 * pid — a total order every waiter computes identically from the same
 * registry, which is what lets "only the head may take the mutex" be a rule
 * each waiter applies to itself with no coordinator.
 */
export function admissionOrder<W extends GateWaiter>(
    waiters: readonly W[],
    now: number,
    ageStepMs: number = AGE_STEP_MS
): W[] {
    return [...waiters].sort(
        (a, b) =>
            agedClass(a, now, ageStepMs) - agedClass(b, now, ageStepMs) ||
            a.since - b.since ||
            a.pid - b.pid
    );
}

/** How a waiter reads in a line: its class, and the class ageing has carried
 *  it to when that is no longer its own. */
export function describeClass(
    w: Pick<GateWaiter, "role" | "tier" | "since">,
    now: number,
    ageStepMs: number = AGE_STEP_MS
): string {
    const born = admissionClass(w);
    const aged = agedClass(w, now, ageStepMs);
    return aged === born
        ? ADMISSION_CLASSES[born]
        : `${ADMISSION_CLASSES[born]}, aged to ${ADMISSION_CLASSES[aged]}`;
}

/**
 * Whether a registry entry still stands for a queued process. A waiter stamps
 * `seen` on every poll, so an entry is live while its pid exists AND it polled
 * within `staleMs`. The second half is not belt-and-braces: a gate killed
 * while still queued leaves its entry behind, macOS reuses pids within hours,
 * and under ordered admission one such entry at the head would block the
 * queue for ever. Its age since ENTERING the queue is deliberately not read —
 * ageing makes a 90-minute wait legitimate.
 */
export function waiterLive(
    w: Pick<GateWaiter, "since" | "seen">,
    pidAlive: boolean,
    now: number,
    staleMs: number
): boolean {
    const seen = typeof w.seen === "number" ? w.seen : w.since;
    return pidAlive && typeof seen === "number" && now - seen <= staleMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// TREE TEARDOWN (issue #4965)
// ─────────────────────────────────────────────────────────────────────────────

/** One row of `ps -Ao pid=,ppid=,pgid=,stat=`. */
export interface PsRow {
    pid: number;
    ppid: number;
    pgid: number;
    /** Exited, not yet reaped. It holds no CPU and cannot be signalled; a
     *  holder blocked in its own teardown cannot reap, so it must not count
     *  as a survivor. */
    zombie: boolean;
}

/** Null when the output carries no parseable row — "unmeasurable". */
export function parsePsRows(psOutput: string): PsRow[] | null {
    const rows: PsRow[] = [];
    for (const line of psOutput.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
        if (!m) continue;
        rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            zombie: m[4].startsWith("Z"),
        });
    }
    return rows.length ? rows : null;
}

/**
 * Everything a wrapped command has ever been seen to own, across `ps`
 * snapshots: the pids of its tree and the process groups they lead or sit in.
 *
 * One group is not the tree. The gate spawns its child `detached` so the
 * child's group is a handle that survives reparenting — but a NESTED
 * `gate.ts` (every `bun run test` inside a locked `land`) does the same for
 * ITS child, which therefore sits in a second group the outer handle never
 * reaches. Observed 2026-10-02: the holder was SIGTERMed, signalled its one
 * group, released, and a `vitest run --project node-engine` in its own group
 * kept four workers burning, reparented to pid 1, under the next holder.
 *
 * So the tree is WALKED (parent links, while they still exist) and every
 * group met is remembered: the walk finds what is nested, the groups keep
 * hold of it once the signal has killed the parents the walk went through.
 */
export class TrackedTree {
    readonly pids = new Set<number>();
    readonly groups = new Set<number>();
    private readonly protectedGroups: ReadonlySet<number>;

    /**
     * `root` is the gate's own child — a group LEADER by construction, so its
     * pid is seeded as a group too: that is the one handle left when the root
     * exited by itself and its children were reparented. `protectedGroups` are
     * never signalled as groups — the signaller's own above all, where a
     * group signal would take down the gate and the session behind it.
     */
    constructor(
        root: number,
        protectedGroups: ReadonlySet<number> = new Set()
    ) {
        this.protectedGroups = protectedGroups;
        this.pids.add(root);
        this.addGroup(root);
    }

    private addGroup(pgid: number) {
        if (pgid > 1 && !this.protectedGroups.has(pgid)) this.groups.add(pgid);
    }

    /** Fold one snapshot in; the LIVE processes still owned by the tree. */
    absorb(rows: readonly PsRow[]): PsRow[] {
        const kids = new Map<number, PsRow[]>();
        for (const r of rows) {
            const bucket = kids.get(r.ppid);
            if (bucket) bucket.push(r);
            else kids.set(r.ppid, [r]);
        }
        // A fixpoint, not one pass: a process pulled in by its group can have
        // children outside it, and a child's group can hold strangers to the
        // parent chain (a reparented sibling).
        for (let grew = true; grew; ) {
            grew = false;
            for (const r of rows) {
                const owned =
                    this.pids.has(r.pid) ||
                    this.pids.has(r.ppid) ||
                    this.groups.has(r.pgid);
                if (!owned) continue;
                if (!this.pids.has(r.pid)) {
                    this.pids.add(r.pid);
                    grew = true;
                }
                if (!this.groups.has(r.pgid)) {
                    const before = this.groups.size;
                    this.addGroup(r.pgid);
                    if (this.groups.size !== before) grew = true;
                }
            }
        }
        return rows.filter(
            (r) =>
                !r.zombie && (this.pids.has(r.pid) || this.groups.has(r.pgid))
        );
    }
}
