// The deployment watch (issue #6081): `check:ui` probes the Convex deployment
// for the whole walk. Two consecutive failed probes abort the run as
// `DEPLOYMENT_DOWN_EXIT` within two probe intervals, the open cells listed and
// the lane account teardown skipped so the UI lane is released at once; one
// transient failure aborts nothing; a cell that failed while a probe did is
// `deployment-down`, never the tree's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DeploymentDownAbort,
    PROBE_QUERY,
    convexProbe,
    probeStateLabel,
    untilDeploymentDown,
    watchDeployment,
    type Probe,
    type ProbeFetch,
    type ProbeResult,
} from "../ui-gate/deployment-watch";
import {
    openCellsLines,
    runCellAttempts,
    type CellAttemptDeps,
} from "../ui-gate/cell-deadline";
import { UNSETTLED_MESSAGE_PREFIX } from "../ui-gate/infra-verdict";
import {
    createLaneFleet,
    newLaneAccount,
    withLaneFleet,
} from "../ui-gate/lane-account";
import { runPool } from "../ui-gate/parallel";

const INTERVAL = 15_000;
const UP: ProbeResult = { ok: true };
const DOWN: ProbeResult = { ok: false, reason: "/version did not answer" };

/** A probe answering from a script, one entry per call; the last repeats. */
function scripted(answers: readonly ProbeResult[]): Probe & { calls: number } {
    const probe = Object.assign(
        async () => {
            const answer = answers[Math.min(probe.calls, answers.length - 1)];
            probe.calls++;
            return answer;
        },
        { calls: 0 }
    );
    return probe;
}

function watch(probe: Probe, notes: string[] = []) {
    return watchDeployment({
        probe,
        intervalMs: INTERVAL,
        now: Date.now,
        timer: {
            setInterval,
            clearInterval: (h) =>
                clearInterval(h as ReturnType<typeof setInterval>),
        },
        note: (line) => notes.push(line),
    });
}

const never = <T>(): Promise<T> => new Promise<T>(() => {});

describe("watchDeployment — a backend that dies mid-walk aborts the run", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("ends a never-finishing walk within two probe intervals of the first failed probe, the open cells listed and no account destroyed", async () => {
        // Up for two probes, then dead for good.
        const probe = scripted([UP, UP, DOWN]);
        const w = watch(probe);
        const progress = new Map<string, string>();
        const reported = new Set<string>();
        const destroys: string[] = [];
        const logs: string[] = [];
        const fleet = createLaneFleet({
            accounts: [newLaneAccount()],
            host: newLaneAccount(),
            run: (fn) => {
                if (fn.endsWith("destroyLaneAccount")) destroys.push(fn);
                return fn.endsWith("sweepStaleLaneAccounts")
                    ? { swept: [] }
                    : null;
            },
            signUp: async (a) => `token-of-${a.runId}`,
            seedDeck: async (a) => `deck-of-${a.runId}`,
            seedJoinTable: async (a) => `table-of-${a.runId}`,
            keepUser: false,
            log: (m) => logs.push(m),
        });

        let settledAt: number | null = null;
        let open: string[] = [];
        const run = withLaneFleet(fleet, () =>
            untilDeploymentDown(
                () =>
                    runPool(["phone", "desktop"], 2, async (id) => {
                        progress.set(id, "lobby");
                        // Every cell against a dead backend: never settles.
                        return never<string>();
                    }),
                w
            ).catch((err: unknown) => {
                if (err instanceof DeploymentDownAbort) {
                    open = openCellsLines(
                        ["phone", "desktop"],
                        progress,
                        reported
                    );
                    fleet.abandon("the deployment is down");
                }
                throw err;
            })
        ).finally(() => {
            settledAt = Date.now();
        });
        run.catch(() => {});

        const start = Date.now();
        await vi.advanceTimersByTimeAsync(2 * INTERVAL);
        expect(settledAt).toBeNull();
        const firstFailureAt = start + 3 * INTERVAL;
        await vi.advanceTimersByTimeAsync(3 * INTERVAL);

        await expect(run).rejects.toBeInstanceOf(DeploymentDownAbort);
        expect(settledAt).not.toBeNull();
        expect(settledAt! - firstFailureAt).toBeLessThanOrEqual(INTERVAL);
        expect(open).toEqual([
            "  open: phone        lobby",
            "  open: desktop      lobby",
        ]);
        expect(destroys).toEqual([]);
        // The watch stops itself once it has declared the deployment down.
        const callsAtDown = probe.calls;
        await vi.advanceTimersByTimeAsync(5 * INTERVAL);
        expect(probe.calls).toBe(callsAtDown);
        expect(w.state().down).toBe(true);
    });

    it("a single transient failure does not abort the run", async () => {
        const notes: string[] = [];
        const w = watch(scripted([UP, DOWN, UP, UP, DOWN, UP]), notes);
        let finished = false;
        const run = untilDeploymentDown(async () => {
            await new Promise((r) => setTimeout(r, 6.5 * INTERVAL));
            return "walked";
        }, w).then((v) => {
            finished = true;
            return v;
        });
        await vi.advanceTimersByTimeAsync(7 * INTERVAL);
        expect(finished).toBe(true);
        await expect(run).resolves.toBe("walked");
        expect(w.state()).toMatchObject({
            down: false,
            consecutiveFailures: 0,
        });
        expect(notes).toEqual([
            "convex probe failed (1/2) — /version did not answer",
            "convex answers again after 1 failed probe(s)",
            "convex probe failed (1/2) — /version did not answer",
            "convex answers again after 1 failed probe(s)",
        ]);
        w.stop();
    });

    it("never stacks probes: a tick that finds one in flight is skipped", async () => {
        let calls = 0;
        const w = watch(() => {
            calls++;
            return never<ProbeResult>();
        });
        await vi.advanceTimersByTimeAsync(5 * INTERVAL);
        expect(calls).toBe(1);
        w.stop();
    });

    it("failedSince names a failure at or after the instant, and only then", async () => {
        const w = watch(scripted([UP, DOWN, UP]));
        await vi.advanceTimersByTimeAsync(INTERVAL);
        const beforeFailure = Date.now();
        expect(w.failedSince(beforeFailure)).toBe(false);
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(w.failedSince(beforeFailure)).toBe(true);
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(w.failedSince(Date.now())).toBe(false);
        w.stop();
    });
});

describe("a cell failing while a probe failed is the deployment's", () => {
    const cellDeps = (
        failedSince: (ms: number) => boolean
    ): CellAttemptDeps<number> => ({
        attempt: async () => {
            throw new Error(`${UNSETTLED_MESSAGE_PREFIX} within 30000ms`);
        },
        attemptConsole: async () => [],
        reasonOf: (err) => (err as Error).message,
        onDeadline: () => {},
        beforeRetry: async () => {},
        note: () => {},
        deadlineMs: 1_000,
        policy: {
            maxAttempts: 2,
            loadThreshold: 8,
            pollMs: 5_000,
            maxWaitMs: 30_000,
        },
        // A quiet machine: without the probe this stands UNWALKED.
        loadAverage: () => 0.5,
        sleep: async () => {},
        where: "lobby @ phone",
        deployment: { now: () => 1_000, failedSince },
    });

    it("stands INFRA deployment-down at any load", async () => {
        expect(
            await runCellAttempts(cellDeps((since) => since <= 1_000))
        ).toMatchObject({ kind: "INFRA", signature: "deployment-down" });
    });

    it("with every probe green it is the walk's own unsettled screen", async () => {
        expect(await runCellAttempts(cellDeps(() => false))).toMatchObject({
            kind: "UNWALKED",
        });
    });
});

describe("convexProbe", () => {
    type Route = (init: Parameters<ProbeFetch>[1]) => ReturnType<ProbeFetch>;
    const respond = (status: number, body: unknown = {}) =>
        Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        });
    const fetchOf =
        (version: Route, query: Route): ProbeFetch =>
        (url, init) =>
            url.endsWith("/version") ? version(init) : query(init);

    it("is ok when /version answers and the probe query succeeds", async () => {
        const bodies: string[] = [];
        const probe = convexProbe(
            "http://127.0.0.1:3210/",
            1_000,
            fetchOf(
                () => respond(200),
                (init) => {
                    bodies.push(init.body ?? "");
                    return respond(200, { status: "success", value: null });
                }
            )
        );
        expect(await probe()).toEqual({ ok: true });
        expect(JSON.parse(bodies[0])).toEqual({
            path: PROBE_QUERY,
            args: {},
            format: "json",
        });
    });

    it("fails when nothing listens", async () => {
        const probe = convexProbe(
            "http://127.0.0.1:3210",
            1_000,
            fetchOf(
                () => Promise.reject(new Error("Unable to connect")),
                () => respond(200, { status: "success" })
            )
        );
        expect(await probe()).toEqual({
            ok: false,
            reason: "/version — Unable to connect",
        });
    });

    it("fails when the HTTP server answers but the function runner does not", async () => {
        const probe = convexProbe(
            "http://127.0.0.1:3210",
            1_000,
            fetchOf(
                () => respond(200),
                () =>
                    respond(200, {
                        status: "error",
                        errorMessage:
                            "[Request ID: 1] Server Error\nFunction execution timed out (maximum duration: 1s)",
                    })
            )
        );
        expect(await probe()).toEqual({
            ok: false,
            reason: `query ${PROBE_QUERY} failed — [Request ID: 1] Server Error`,
        });
    });

    it("fails on a query that never answers, within its timeout", async () => {
        const probe = convexProbe(
            "http://127.0.0.1:3210",
            20,
            fetchOf(
                () => respond(200),
                (init) =>
                    new Promise((_r, reject) =>
                        init.signal.addEventListener("abort", () =>
                            reject(new Error("aborted"))
                        )
                    )
            )
        );
        expect(await probe()).toEqual({
            ok: false,
            reason: `query ${PROBE_QUERY} did not answer within 20ms`,
        });
    });
});

describe("probeStateLabel — what the live progress prints", () => {
    const base = {
        lastOkAtMs: 10_000,
        consecutiveFailures: 0,
        lastFailure: null,
        down: false,
    };
    it("names the age of the last good probe, a failing streak, or DOWN", () => {
        expect(probeStateLabel(base, 13_400)).toBe("convex ok 3s ago");
        expect(
            probeStateLabel(
                { ...base, consecutiveFailures: 1, lastFailure: "x" },
                13_400
            )
        ).toBe("convex probe failing (1/2)");
        expect(
            probeStateLabel(
                { ...base, consecutiveFailures: 2, down: true },
                13_400
            )
        ).toBe("convex DOWN");
        expect(probeStateLabel({ ...base, lastOkAtMs: null }, 0)).toBe(
            "convex unprobed"
        );
    });
});
