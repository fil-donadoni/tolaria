/**
 * Machine-wide admission for `check:ui` (issue #4687).
 *
 * WHY. `check:ui` boots its own Vite and headless Chrome against the SAME local
 * Convex backend, and took no lock: two to four full runs overlapped for hours
 * on issue #4422, backend queries hit the 1 s function limit, and the game
 * walks failed in ways that read as UI defects — so a red row was attributable
 * to no diff, and every session paid a full re-run to find that out.
 *
 * MODEL. One exclusive lane, taken only around the part of a run that needs the
 * browser: `--scope-only` and an empty scope never call it, so a PR that owes
 * no receipt is never slowed. It is a SEPARATE mutex from the heavy gate's
 * (`gate.lock`): a `check:ui` holder must not block `land`, and a `land` must
 * not wait on a browser run. Same contract otherwise — the lock is an
 * out-of-repo directory (worktrees share it), the holder is named, a dead
 * holder is reclaimed, and a live one that stopped heartbeating is reclaimed
 * after `staleMs`. `gate:who` prints it (`uiLaneWhoLines`).
 *
 * THE MACHINE (issue #4966). Holding the lane is not the same as having a
 * machine to walk on: the full walk of aa785cf0 took the lane at load 14.5 and
 * ended with 37 cells `INFRA` and 48 `UNWALKED`. So a run that holds the lane
 * asks `lib/machine-admission.ts` before it starts a browser (`admitMachine`):
 * it waits, bounded, and past the bound gives the lane back and throws
 * `MachineSaturatedError` — nothing walked, exit `MACHINE_SATURATED_EXIT`.
 * It asks with no hold on the heavy mutex, so the load of a heavy gate that
 * is running is not waited on (`admitUiMachine`, issue #4988): beside a live
 * holder the lane's rule is one viewport at a time, not INFRA.
 *
 * EVERY EXIT PATH. `acquireUiLane` releases on the `exit` event (normal end,
 * `process.exit`, an uncaught throw) and on SIGINT / SIGTERM / SIGHUP; where
 * another handler owns the signal it leaves the exit to that handler, whose
 * `process.exit` reaches the `exit` release. A SIGKILL leaves a dead pid, which
 * the next waiter reclaims.
 */
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
    reclaimVerdict,
    STALLED_RECLAIM_MS,
    waiterLive,
    WAITER_STALE_MS,
    type GateWaiter,
} from "./gate-liveness";
import {
    waitForMachine,
    type MachineThresholds,
    type WaitForMachineInput,
} from "./machine-admission";

/** The lock root the heavy gate uses, so `gate:who` and this lane agree. */
export function gateLockRoot(env: NodeJS.ProcessEnv = process.env): string {
    return env.TOLARIA_GATE_LOCK_ROOT ?? join(homedir(), ".cache", "tolaria");
}

const LOCK_NAME = "ui.lock";
const OWNER_NAME = "owner.json";

/** A holder silent this long is presumed hung (its heartbeat is an in-process
 *  timer, so silence means a blocked event loop or a frozen process). A full
 *  contended lane ran 90 min; the timer beats every 5, so 45 min of silence is
 *  far past any healthy pause. */
export const UI_LANE_STALE_MS = 45 * 60 * 1000;
export const UI_LANE_HEARTBEAT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

export interface UiLaneOwner {
    pid: number;
    label: string;
    cwd: string;
    /** Heartbeat: the last time the holder attested to being alive. */
    ts: number;
    acquiredAt: number;
}

export interface UiLaneHold {
    /** Free the lane. Idempotent, and never steals a lane another pid holds. */
    release(): void;
}

export interface AcquireUiLaneInput {
    root: string;
    label: string;
    cwd?: string;
    pid?: number;
    /** Prints a line to the operator (waiting notice, reclaim notice). */
    announce: (line: string) => void;
    now?: () => number;
    isAlive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
    staleMs?: number;
    heartbeatMs?: number;
    /** Tests drive the hold in-process and release by hand. */
    installExitHandlers?: boolean;
    /** Asked once the lane is held: may a browser start on this machine?
     *  `false` — the bounded wait ran out — frees the lane and throws
     *  `MachineSaturatedError`. Absent, the machine is not asked. */
    admitMachine?: () => Promise<boolean>;
}

/** The lane was taken and the machine stayed saturated past the bound: no
 *  browser started, and the lane has been given back. */
export class MachineSaturatedError extends Error {
    constructor() {
        super(
            "the machine stayed saturated past the bound — nothing was walked"
        );
    }
}

function lockDir(root: string): string {
    return join(root, LOCK_NAME);
}

function ownerFile(root: string): string {
    return join(lockDir(root), OWNER_NAME);
}

export function readUiLaneOwner(root: string): UiLaneOwner | null {
    try {
        return JSON.parse(readFileSync(ownerFile(root), "utf8")) as UiLaneOwner;
    } catch {
        return null;
    }
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** Who holds the lane, from where, since when — what a waiter needs to act on. */
export function uiLaneHolderLine(owner: UiLaneOwner, now: number): string {
    return [
        `pid ${owner.pid}`,
        `held ${fmtDuration(now - owner.acquiredAt)}`,
        `last heartbeat ${fmtDuration(now - owner.ts)} ago`,
        owner.cwd,
        owner.label,
    ].join(" · ");
}

/** The heavy gate's owner stamp, as `gate.ts` writes it under `gate.lock`. */
export interface HeavyGateOwner {
    pid: number;
    label: string;
    cwd: string;
    ts: number;
    acquiredAt?: number;
    /** Set once the holder declared its own stall: reclaimable minutes
     *  later, not after `HEAVY_STALE_MS` (issue #4965). */
    stalledAt?: number;
    /** The pid of the holder's command, stamped at the spawn: absent while
     *  the holder still waits for the machine under its hold. */
    childPid?: number;
}

/** `gate.ts`'s STALE_MS default: a holder silent this long is reclaimable,
 *  so it no longer counts as holding the machine. */
const HEAVY_STALE_MS = 45 * 60 * 1000;

/**
 * The heavy gate's LIVE holder, or null (issue #4941) — what `check:ui` asks
 * before it sizes its pool, so it never starts five Chrome contexts beside a
 * suite, a sweep or a `land` that holds the machine.
 *
 * Null when no lock is held, when the holder is dead, has gone silent past
 * the reclaim threshold or declared its stall long enough ago to be reclaimed
 * (the head of the queue takes it — it holds nothing), and
 * when THIS process runs under the hold itself (`TOLARIA_GATE_HELD=1`): the
 * holder is then our own ancestor, and the machine is ours.
 */
export function heavyHolderLive(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
    isAlive: (pid: number) => boolean = pidAlive,
    staleMs: number = HEAVY_STALE_MS,
    stalledReclaimMs: number = STALLED_RECLAIM_MS
): HeavyGateOwner | null {
    if (env.TOLARIA_GATE_HELD === "1") return null;
    let owner: HeavyGateOwner;
    try {
        owner = JSON.parse(
            readFileSync(join(root, "gate.lock", OWNER_NAME), "utf8")
        ) as HeavyGateOwner;
    } catch {
        return null;
    }
    return reclaimVerdict(
        owner,
        isAlive(owner.pid),
        now,
        staleMs,
        stalledReclaimMs
    ) === null
        ? owner
        : null;
}

/**
 * The live heavy holder whose COMMAND IS RUNNING, or null (issue #4988) — the
 * one a 1-minute load over `machine.loadMax` is accounted to by a caller that
 * asks the machine with no hold on the mutex (`land`'s preflight, `check:ui`).
 *
 * Narrower than `heavyHolderLive` on purpose. A holder still waiting for the
 * machine under its hold has spawned nothing (`gate.ts` stamps `childPid` at
 * the spawn): the load is not its own, and a caller that started beside it
 * would hold up the very calm that holder waits for. A holder that declared
 * its stall burns no CPU, so it raises no load either. Beside those two the
 * off-mutex caller waits as it would with the mutex free.
 */
export function heavyHolderRunning(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
    isAlive: (pid: number) => boolean = pidAlive,
    staleMs: number = HEAVY_STALE_MS
): HeavyGateOwner | null {
    const owner = heavyHolderLive(root, env, now, isAlive, staleMs);
    return owner !== null &&
        typeof owner.childPid === "number" &&
        owner.stalledAt === undefined
        ? owner
        : null;
}

/** `gate.ts`'s default grace for a lock not yet stamped with its owner. */
const OWNERLESS_GRACE_MS = 5000;

/** Age of a `gate.lock` that carries no owner stamp; Infinity when there is
 *  no lock, or it has its owner (that case is `heavyHolderLive`'s). */
function ownerlessLockAgeMs(root: string, now: number): number {
    const dir = join(root, "gate.lock");
    if (existsSync(join(dir, OWNER_NAME))) return Infinity;
    try {
        return now - statSync(dir).mtimeMs;
    } catch {
        return Infinity;
    }
}

/** The heavy mutex's queue: one file per process waiting on `gate.lock`,
 *  beside it (`gate.ts` § waiter registry). */
export const GATE_WAITERS_DIR = "gate.waiters";

/**
 * Every entry of the waiter registry that parses — READ ONLY (issue #4992).
 * `gate.ts`'s own reader prunes what it finds dead as it reads, which is its
 * business as a member of the queue; a caller OUTSIDE the queue (`land`
 * deciding whether there is a queue at all) must leave it exactly as it
 * found it. A temp file mid-rename and a foreign file are not entries.
 */
export function readGateWaiters(root: string): GateWaiter[] {
    const dir = join(root, GATE_WAITERS_DIR);
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const out: GateWaiter[] = [];
    for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
            const entry = JSON.parse(
                readFileSync(join(dir, name), "utf8")
            ) as GateWaiter;
            if (typeof entry.pid === "number") out.push(entry);
        } catch {
            /* foreign or half-written — never a verdict */
        }
    }
    return out;
}

/**
 * Whether the heavy mutex is FREE and NOBODY IS QUEUED on it (issue #4992) —
 * the one moment `land`'s preflight keeps nothing out of anything.
 *
 * "Live" is what the gate means by it, under the gate's own thresholds: a
 * holder that is dead or reclaimable holds nothing (`heavyHolderLive`), while
 * one still waiting for the machine under its hold does; an entry is a waiter
 * only while `waiterLive` says it stands for a queued process. Reads only.
 */
export function heavyQueueIdle(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
    isAlive: (pid: number) => boolean = pidAlive
): boolean {
    const staleMs = Number(env.TOLARIA_GATE_STALE_MS ?? HEAVY_STALE_MS);
    const stalledMs = Number(
        env.TOLARIA_GATE_STALLED_RECLAIM_MS ?? STALLED_RECLAIM_MS
    );
    if (heavyHolderLive(root, env, now, isAlive, staleMs, stalledMs) !== null)
        return false;
    // A lock with no owner stamp yet is a gate between its `mkdir` and its
    // stamp — a holder, as the gate reads it, until it is old enough to be
    // an orphan (`OWNERLESS_GRACE_MS` there).
    const graceMs = Number(
        env.TOLARIA_GATE_OWNERLESS_GRACE_MS ?? OWNERLESS_GRACE_MS
    );
    if (ownerlessLockAgeMs(root, now) < graceMs) return false;
    const waiterStaleMs = Number(
        env.TOLARIA_GATE_WAITER_STALE_MS ?? WAITER_STALE_MS
    );
    return !readGateWaiters(root).some((w) =>
        waiterLive(w, isAlive(w.pid), now, waiterStaleMs)
    );
}

/** The holder, as a machine-wait line names it. */
export function heavyHolderLine(owner: HeavyGateOwner): string {
    return `pid ${owner.pid} · ${owner.label}`;
}

/** `waitForMachine`'s `heavyHolder` probe for an off-mutex caller. */
export function runningHolderLine(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
    isAlive?: (pid: number) => boolean
): string | null {
    const owner = heavyHolderRunning(root, env, now, isAlive);
    return owner === null ? null : heavyHolderLine(owner);
}

export interface UiMachineAdmission {
    admitted: boolean;
    /** The running heavy holder the walk was admitted BESIDE, over
     *  `machine.loadMax`: the walk is sized to one viewport for it even when
     *  it has released by the time the pool is sized — the load it left has
     *  not. Null on a calm machine. */
    beside: HeavyGateOwner | null;
}

/**
 * `check:ui`'s machine admission, asked once the lane is held (issue #4966)
 * and with no hold on the heavy mutex — so a running heavy holder's load is
 * not waited on (issue #4988): the lane's rule for a live holder is "walk one
 * viewport at a time" (issue #4941), never "wait for it to finish". Memory
 * pressure, and load nothing of ours explains, wait as before, bounded.
 */
export async function admitUiMachine(
    input: {
        root: string;
        thresholds: MachineThresholds;
        announce: (line: string) => void;
        isAlive?: (pid: number) => boolean;
    } & Pick<WaitForMachineInput, "env" | "probe" | "now" | "sleep" | "pollMs">
): Promise<UiMachineAdmission> {
    const env = input.env ?? process.env;
    const now = input.now ?? Date.now;
    const seen: { holder: HeavyGateOwner | null } = { holder: null };
    const machine = await waitForMachine({
        thresholds: input.thresholds,
        tag: "[check:ui]",
        announce: input.announce,
        env,
        probe: input.probe,
        now,
        sleep: input.sleep,
        pollMs: input.pollMs,
        heavyHolder: () => {
            seen.holder = heavyHolderRunning(
                input.root,
                env,
                now(),
                input.isAlive
            );
            return seen.holder === null ? null : heavyHolderLine(seen.holder);
        },
    });
    return {
        admitted: machine.admitted,
        beside: machine.beside === null ? null : seen.holder,
    };
}

/** `gate:who`'s lines for this lane. Empty is never printed as "free": the
 *  caller prints one line either way. */
export function uiLaneWhoLines(
    root: string,
    now: number = Date.now(),
    isAlive: (pid: number) => boolean = pidAlive
): string[] {
    const owner = readUiLaneOwner(root);
    if (!owner) return ["[gate] check:ui lane is free"];
    const live = isAlive(owner.pid);
    return [
        `[gate] check:ui lane — ${uiLaneHolderLine(owner, now)}`,
        live
            ? `[gate]   holder pid alive · reclaimable in ${fmtDuration(UI_LANE_STALE_MS - (now - owner.ts))} if it goes silent`
            : "[gate]   holder is dead — the next check:ui run reclaims it",
    ];
}

function tryTake(root: string, owner: UiLaneOwner): boolean {
    try {
        mkdirSync(lockDir(root), { recursive: false });
    } catch {
        return false;
    }
    writeFileSync(ownerFile(root), JSON.stringify(owner));
    return true;
}

export async function acquireUiLane(
    input: AcquireUiLaneInput
): Promise<UiLaneHold> {
    const {
        root,
        label,
        announce,
        now = Date.now,
        isAlive = pidAlive,
        sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        pollMs = POLL_MS,
        staleMs = UI_LANE_STALE_MS,
        heartbeatMs = UI_LANE_HEARTBEAT_MS,
        installExitHandlers = true,
    } = input;
    const pid = input.pid ?? process.pid;
    const cwd = input.cwd ?? process.cwd();
    mkdirSync(root, { recursive: true });

    const t0 = now();
    let announcedFor: number | null = null;
    let lastAnnounce = 0;
    for (;;) {
        const taken = now();
        const mine: UiLaneOwner = {
            pid,
            label: label.slice(0, 120),
            cwd,
            ts: taken,
            acquiredAt: taken,
        };
        if (tryTake(root, mine)) break;
        const owner = readUiLaneOwner(root);
        const verdict = reclaimVerdict(
            owner,
            !!owner && isAlive(owner.pid),
            now(),
            staleMs
        );
        if (verdict || !owner) {
            announce(
                `[check:ui] reclaiming the lane — ${
                    verdict === "stalled" && owner
                        ? `pid ${owner.pid} is alive but has not heartbeated in ${fmtDuration(now() - owner.ts)}`
                        : `holder is gone${owner ? ` (${uiLaneHolderLine(owner, now())})` : ""}`
                }`
            );
            rmSync(lockDir(root), { recursive: true, force: true });
            continue;
        }
        const t = now();
        if (announcedFor !== owner.pid || t - lastAnnounce >= 60_000) {
            announce(
                `[check:ui] waiting ${fmtDuration(t - t0)} for the check:ui lane — ${uiLaneHolderLine(owner, t)}`
            );
            announcedFor = owner.pid;
            lastAnnounce = t;
        }
        await sleep(pollMs + Math.random() * 500);
    }
    if (announcedFor !== null) {
        announce(
            `[check:ui] acquired the check:ui lane after ${fmtDuration(now() - t0)}`
        );
    }

    let released = false;
    const timer = setInterval(() => {
        const owner = readUiLaneOwner(root);
        if (!owner || owner.pid !== pid) return;
        try {
            writeFileSync(
                ownerFile(root),
                JSON.stringify({ ...owner, ts: now() })
            );
        } catch {
            /* mid-release — never crash the run for a heartbeat */
        }
    }, heartbeatMs);
    timer.unref();

    const release = () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        const owner = readUiLaneOwner(root);
        if (owner && owner.pid !== pid) return; // never steal on exit
        rmSync(lockDir(root), { recursive: true, force: true });
    };

    if (installExitHandlers) {
        process.on("exit", release);
        for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
            process.once(sig, () => {
                release();
                // Another handler (the fleet teardown) owns this signal and
                // exits through `process.exit`; with none, exit here.
                if (process.listenerCount(sig) === 0) {
                    process.exit(
                        128 + (sig === "SIGINT" ? 2 : sig === "SIGHUP" ? 1 : 15)
                    );
                }
            });
        }
    }
    // After the handlers: the wait is minutes long, and a signal during it
    // must still give the lane back.
    if (input.admitMachine && !(await input.admitMachine())) {
        release();
        throw new MachineSaturatedError();
    }
    return { release };
}
