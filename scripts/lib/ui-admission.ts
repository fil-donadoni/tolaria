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
 * EVERY EXIT PATH. `acquireUiLane` releases on the `exit` event (normal end,
 * `process.exit`, an uncaught throw) and on SIGINT / SIGTERM / SIGHUP; where
 * another handler owns the signal it leaves the exit to that handler, whose
 * `process.exit` reaches the `exit` release. A SIGKILL leaves a dead pid, which
 * the next waiter reclaims.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { reclaimVerdict } from "./gate-liveness";

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
    return { release };
}
