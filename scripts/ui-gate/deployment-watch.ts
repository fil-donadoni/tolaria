/**
 * The deployment watch (issue #6081): `check:ui` asks whether the Convex
 * deployment answers for the WHOLE walk, not only once at start.
 *
 * WHY. The start-up check (`reachable` in `lib/convex-reachable.ts`) caught a
 * backend that was already down. One that died mid-run was not recognised as
 * the cause: on 2026-10-19 the local backend died under `convex dev` (alive,
 * no `convex-local-backend` child, nothing on :3210) and a SCOPED run spent
 * 55 minutes retrying 155 cells into `unsettled` / `INFRA` — a receipt that
 * blamed the tree, while the run held the UI lane every other session waits
 * on.
 *
 * WHAT IS HERE.
 *
 *   1. `convexProbe` — one probe: `GET /version` (is anything listening?) then
 *      a round-trip of a public query that reads nothing for a signed-out
 *      caller (`users:currentUser`), because an HTTP server can answer while
 *      the function runner is wedged — the `Function execution timed out`
 *      every page saw on 2026-10-19.
 *   2. `watchDeployment` — the probe on a cadence. `failuresToAbort`
 *      CONSECUTIVE failures (default 2) declare the deployment down and settle
 *      `down`; one transient failure is only noted, and the next success
 *      clears it.
 *   3. `untilDeploymentDown` — a piece of work raced against `down`: the walk
 *      is abandoned (never awaited) and `DeploymentDownAbort` is thrown, which
 *      `index.ts` turns into `DEPLOYMENT_DOWN_EXIT` with no receipt.
 *   4. `probeStateLabel` — the probe state as the live progress prints it.
 *
 * No browser, no `os`: the probe, the clock and the timer are injected.
 */

/** One probe's answer. */
export type ProbeResult = { ok: true } | { ok: false; reason: string };

export type Probe = () => Promise<ProbeResult>;

/**
 * A public query with no arguments that returns `null` to a signed-out caller
 * after one auth lookup: the cheapest real round-trip through the function
 * runner. Every page of the app subscribes to it, so a deployment that cannot
 * run it cannot serve a single surface.
 */
export const PROBE_QUERY = "users:currentUser";

/** `fetch` as the probe uses it — injected so a test never opens a socket. */
export type ProbeFetch = (
    url: string,
    init: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
        signal: AbortSignal;
    }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The first line of a message, at most 160 characters. */
function firstLine(text: string): string {
    return text.split("\n")[0].slice(0, 160);
}

/**
 * Probe the deployment at `url`: `/version` must answer 2xx and
 * `PROBE_QUERY` must come back `success`, each within `timeoutMs`.
 */
export function convexProbe(
    url: string,
    timeoutMs: number,
    fetchImpl: ProbeFetch = fetch as unknown as ProbeFetch
): Probe {
    const base = url.replace(/\/+$/, "");
    const timed = async <T>(
        what: string,
        call: (signal: AbortSignal) => Promise<T>
    ): Promise<T> => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await call(ctrl.signal);
        } catch (err) {
            throw new Error(
                ctrl.signal.aborted
                    ? `${what} did not answer within ${timeoutMs}ms`
                    : `${what} — ${firstLine((err as Error).message)}`
            );
        } finally {
            clearTimeout(t);
        }
    };
    return async () => {
        try {
            const version = await timed("/version", (signal) =>
                fetchImpl(`${base}/version`, { signal })
            );
            if (!version.ok) {
                return {
                    ok: false,
                    reason: `/version answered HTTP ${version.status}`,
                };
            }
            const body = await timed(`query ${PROBE_QUERY}`, async (signal) => {
                const res = await fetchImpl(`${base}/api/query`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        path: PROBE_QUERY,
                        args: {},
                        format: "json",
                    }),
                    signal,
                });
                if (!res.ok) {
                    throw new Error(`answered HTTP ${res.status}`);
                }
                return (await res.json()) as {
                    status?: string;
                    errorMessage?: string;
                };
            });
            if (body.status !== "success") {
                return {
                    ok: false,
                    reason: `query ${PROBE_QUERY} failed — ${firstLine(body.errorMessage ?? "no error message")}`,
                };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: (err as Error).message };
        }
    };
}

/** What the watch knows, as the progress line and the abort print it. */
export interface ProbeState {
    /** When the last successful probe finished; `null` before the first. */
    lastOkAtMs: number | null;
    /** Failed probes since the last success. */
    consecutiveFailures: number;
    /** The last failure's reason, `null` after a success. */
    lastFailure: string | null;
    /** Set once the deployment was declared down. */
    down: boolean;
}

/** What `down` settles with. */
export interface DeploymentDown {
    failures: number;
    reason: string;
    /** When the last successful probe finished; `null` if none ever did. */
    lastOkAtMs: number | null;
}

export interface DeploymentWatch {
    /** Settles once, when `failuresToAbort` consecutive probes failed. Never
     *  rejects; never settles on a run whose deployment stays up. */
    readonly down: Promise<DeploymentDown>;
    state(): ProbeState;
    /** Did any probe fail at or after `sinceMs`? — a cell failure that
     *  coincides with one is the deployment's, not the tree's. */
    failedSince(sinceMs: number): boolean;
    /** Idempotent: no probe starts after it. */
    stop(): void;
}

export interface WatchTimer {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
}

export interface WatchDeps {
    probe: Probe;
    intervalMs: number;
    failuresToAbort?: number;
    now: () => number;
    timer: WatchTimer;
    /** One line per state change (a failure, a recovery, the verdict). */
    note?: (line: string) => void;
}

/**
 * Probe every `intervalMs`. A tick that finds the previous probe still in
 * flight is skipped, never stacked: the probe bounds itself (`convexProbe`'s
 * timeout), so a hung deployment costs one failed probe per tick at most.
 */
export function watchDeployment(deps: WatchDeps): DeploymentWatch {
    const failuresToAbort = deps.failuresToAbort ?? 2;
    const note = deps.note ?? (() => {});
    const state: ProbeState = {
        lastOkAtMs: null,
        consecutiveFailures: 0,
        lastFailure: null,
        down: false,
    };
    /** Only the latest failure time matters to `failedSince`. */
    let lastFailureAtMs: number | null = null;
    let inFlight = false;
    let stopped = false;
    let declare: (d: DeploymentDown) => void = () => {};
    const down = new Promise<DeploymentDown>((resolve) => {
        declare = resolve;
    });

    const tick = async () => {
        if (inFlight || stopped || state.down) return;
        inFlight = true;
        let result: ProbeResult;
        try {
            result = await deps.probe();
        } catch (err) {
            result = { ok: false, reason: (err as Error).message };
        } finally {
            inFlight = false;
        }
        if (stopped) return;
        if (result.ok) {
            if (state.consecutiveFailures > 0) {
                note(
                    `convex answers again after ${state.consecutiveFailures} failed probe(s)`
                );
            }
            state.lastOkAtMs = deps.now();
            state.consecutiveFailures = 0;
            state.lastFailure = null;
            return;
        }
        lastFailureAtMs = deps.now();
        state.consecutiveFailures++;
        state.lastFailure = result.reason;
        note(
            `convex probe failed (${state.consecutiveFailures}/${failuresToAbort}) — ${result.reason}`
        );
        if (state.consecutiveFailures >= failuresToAbort) {
            state.down = true;
            stop();
            declare({
                failures: state.consecutiveFailures,
                reason: result.reason,
                lastOkAtMs: state.lastOkAtMs,
            });
        }
    };

    const handle = deps.timer.setInterval(() => void tick(), deps.intervalMs);
    // Never the thing that keeps the process alive.
    (handle as { unref?: () => void } | null)?.unref?.();
    function stop() {
        if (stopped) return;
        stopped = true;
        deps.timer.clearInterval(handle);
    }

    return {
        down,
        state: () => ({ ...state }),
        failedSince: (sinceMs) =>
            lastFailureAtMs !== null && lastFailureAtMs >= sinceMs,
        stop,
    };
}

/** Thrown by `untilDeploymentDown` when the watch declared the deployment
 *  down before the work finished. */
export class DeploymentDownAbort extends Error {
    readonly down: DeploymentDown;
    constructor(down: DeploymentDown) {
        super(
            `the Convex deployment stopped answering mid-run (${down.failures} consecutive failed probes: ${down.reason})`
        );
        this.down = down;
    }
}

/**
 * Race `work` against the watch. The work's own outcome wins if it comes
 * first; otherwise it is ABANDONED — its eventual rejection swallowed, never
 * awaited, because a walk against a dead deployment ends only when every cell
 * has spent its retries — and `DeploymentDownAbort` is thrown.
 */
export function untilDeploymentDown<T>(
    work: () => Promise<T>,
    watch: Pick<DeploymentWatch, "down">
): Promise<T> {
    const running = work();
    running.catch(() => {});
    return Promise.race([
        running,
        watch.down.then((d) => {
            throw new DeploymentDownAbort(d);
        }),
    ]);
}

/** `convex ok 3s ago` / `convex probe failing (1/2)` / `convex DOWN` /
 *  `convex unprobed` — the probe state as the live progress prints it. */
export function probeStateLabel(
    state: ProbeState,
    nowMs: number,
    failuresToAbort = 2
): string {
    if (state.down) return "convex DOWN";
    if (state.consecutiveFailures > 0) {
        return `convex probe failing (${state.consecutiveFailures}/${failuresToAbort})`;
    }
    if (state.lastOkAtMs === null) return "convex unprobed";
    const ago = Math.max(0, Math.round((nowMs - state.lastOkAtMs) / 1000));
    return `convex ok ${ago}s ago`;
}
