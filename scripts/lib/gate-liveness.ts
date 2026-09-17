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
    /** Latched: a stalled holder never vouches for itself again. */
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
 * refreshing, and `latched` every beat after it.
 */
export type BeatVerdict = "progress" | "silent" | "stalled" | "latched";

/**
 * One heartbeat step over (previous state, sampled total).
 *
 * Unmeasurable (`null`) counts as progress: never reclaim a holder we cannot
 * judge — reclaiming a healthy holder is the worse failure. The first
 * measurable sample has no baseline and always reads as progress, so detection
 * costs STALL_BEATS + 1 beats.
 */
export function heartbeatStep(
    state: HeartbeatState,
    cpuMs: number | null,
    stallBeats: number
): { state: HeartbeatState; verdict: BeatVerdict } {
    if (state.stalled) return { state, verdict: "latched" };
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

/**
 * Whether a waiter may take the lock from its current holder: a missing owner
 * or a dead pid is an orphan, a live pid whose stamp is older than `staleMs`
 * is a HUNG holder (issue #2999). Both reclaim; they read differently.
 */
export function reclaimVerdict(
    owner: { ts: number } | null,
    holderAlive: boolean,
    now: number,
    staleMs: number
): "dead" | "stalled" | null {
    if (!owner || !holderAlive) return "dead";
    if (now - owner.ts > staleMs) return "stalled";
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The YIELD acquisition (ADR 0136 §6, issue #3780)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One process queued on the heavy mutex, as `gate.ts` records it while it
 * waits. `role` is `TOLARIA_GATE_ROLE`: `land` for a landing, `health` for the
 * batch gate, `""` for every ordinary heavy gate.
 */
export interface GateWaiter {
    pid: number;
    role: string;
    label: string;
    cwd: string;
    /** Epoch ms — when this waiter entered the queue. */
    since: number;
}

/** The role a `yield` acquisition steps aside for. */
export const YIELD_TO_ROLE = "land";
/** The role the per-batch health gate queues under. */
export const HEALTH_ROLE = "health";

export type YieldDecision = {
    verdict: "acquire" | "yield";
    reason: string;
    /** True only on the acquire that the STARVATION BOUND forced. A structured
     *  discriminator, not a phrase in `reason`: the caller announces this one
     *  loudly (a health run overtaking queued lands is worth a line) and stays
     *  quiet about the ordinary "nothing queued" acquire. */
    bounded: boolean;
};

/**
 * Whether a `yield` acquisition may take the mutex now.
 *
 * The batch health gate holds the mutex for ~10 min and a `land` holds it for
 * ~4, so a health run that grabbed the lock the moment it came free would put
 * every queued landing behind ten minutes of full gate for no reason: the tip
 * health is about does not get staler while a land runs — the land only ever
 * ADDS a commit health's next run will cover anyway. So health steps aside
 * while any `land` is queued (scenario B, `docs/guides/next-issue-flow.md`).
 *
 * BOUNDED, because "steps aside" with no bound is starvation: at the observed
 * 2.5 PR/h with three sessions there is frequently SOME land in the queue, and
 * an unbounded yield would mean the base tip is never gated at all — the
 * failure ADR 0136 §6 exists to close. Past `boundMs` of yielding, health
 * takes the mutex like any other heavy gate and the queued lands wait it out.
 *
 * Nothing here can interrupt a RUNNING gate, health's own included: the
 * decision is only ever consulted BEFORE an acquisition, so "once running it
 * is never interrupted" holds by construction, not by a rule.
 */
export function yieldVerdict(input: {
    /** Every OTHER live waiter — `gate.ts` filters out itself and dead pids. */
    waiters: GateWaiter[];
    /** When this process started trying to acquire. */
    yieldingSince: number;
    now: number;
    boundMs: number;
}): YieldDecision {
    const { waiters, yieldingSince, now, boundMs } = input;
    const blocking = waiters.filter((w) => w.role === YIELD_TO_ROLE);
    const yieldedMs = Math.max(0, now - yieldingSince);
    if (blocking.length === 0)
        return {
            verdict: "acquire",
            reason: "no land is queued",
            bounded: false,
        };
    if (yieldedMs >= boundMs)
        return {
            verdict: "acquire",
            reason: `starvation bound reached — yielded ${Math.round(yieldedMs / 1000)}s to ${blocking.length} queued land(s), taking the mutex anyway`,
            bounded: true,
        };
    return {
        verdict: "yield",
        reason: `${blocking.length} land(s) queued (${blocking.map((w) => `pid ${w.pid}`).join(", ")}) — stepping aside, ${Math.round((boundMs - yieldedMs) / 1000)}s of bound left`,
        bounded: false,
    };
}
