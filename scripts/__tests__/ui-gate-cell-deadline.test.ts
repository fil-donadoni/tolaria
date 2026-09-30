// Cell and run deadlines (issue #4912): a `check:ui` cell whose walk never
// settles ends as `INFRA — cell-deadline` within deadline × maxAttempts, and a
// run that outlives its own deadline names the viewports still open and
// rejects — so the lane tears down and exits instead of hanging for half an
// hour with nothing thrown.
//
// Every `it` that could hang carries its own `timeout`: with the deadline
// removed these tests red on the vitest timeout instead of blocking a worker.
import { describe, expect, it } from "vitest";
import {
    DeadlineExpired,
    deadlineFromEnv,
    openCellsLines,
    runCellAttempts,
    withDeadline,
    type AttemptResult,
    type CellAttemptDeps,
} from "../ui-gate/cell-deadline";
import {
    CELL_DEADLINE_MESSAGE_PREFIX,
    classifyWalkFailure,
    standingVerdict,
    type RetryPolicy,
} from "../ui-gate/infra-verdict";
import {
    createLaneFleet,
    newLaneAccount,
    withLaneFleet,
} from "../ui-gate/lane-account";
import { runPool } from "../ui-gate/parallel";

const POLICY: RetryPolicy = {
    maxAttempts: 3,
    loadThreshold: 8,
    pollMs: 5_000,
    maxWaitMs: 30_000,
};
const DEADLINE_MS = 30;
/** A deadline's worth of test budget per attempt, and then some. */
const HANG_TIMEOUT = 2_000;

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** A cell whose every dependency is recorded; `attempt` is the test double. */
function cell<T>(
    attempt: () => Promise<AttemptResult<T>>,
    overrides: Partial<CellAttemptDeps<T>> = {}
) {
    const log = { deadlines: 0, retries: 0, notes: [] as string[] };
    const deps: CellAttemptDeps<T> = {
        attempt,
        attemptConsole: () => [],
        reasonOf: (err) => (err as Error).message,
        onDeadline: () => {
            log.deadlines++;
        },
        beforeRetry: async () => {
            log.retries++;
        },
        note: (line) => log.notes.push(line),
        deadlineMs: DEADLINE_MS,
        policy: POLICY,
        loadAverage: () => 0.5,
        sleep: async () => {},
        where: "lobby @ phone",
        ...overrides,
    };
    return { deps, log };
}

describe("runCellAttempts — a walk that never settles still ends", () => {
    it(
        "ends as INFRA cell-deadline after maxAttempts, closing the page on every attempt",
        async () => {
            const { deps, log } = cell<number>(() => never());
            const started = Date.now();
            const outcome = await runCellAttempts(deps);
            expect(outcome).toMatchObject({
                kind: "INFRA",
                signature: "cell-deadline",
                attempts: POLICY.maxAttempts,
            });
            expect(log.deadlines).toBe(POLICY.maxAttempts);
            expect(log.retries).toBe(POLICY.maxAttempts - 1);
            expect(log.notes).toHaveLength(POLICY.maxAttempts - 1);
            expect(log.notes[0]).toMatch(
                /^infra attempt 1\/3 — cell-deadline, load 0\.5/
            );
            // deadline × maxAttempts, with slack for the scheduler.
            expect(Date.now() - started).toBeLessThan(
                DEADLINE_MS * POLICY.maxAttempts + 500
            );
        },
        HANG_TIMEOUT
    );

    it(
        "stands as INFRA on a quiet machine — the stall is the lane's, not the surface's",
        async () => {
            const { deps } = cell<number>(() => never(), {
                loadAverage: () => 0.1,
            });
            const outcome = await runCellAttempts(deps);
            expect(outcome.kind).toBe("INFRA");
        },
        HANG_TIMEOUT
    );

    it(
        "a retry after a stall that then walks is measured",
        async () => {
            let n = 0;
            const { deps, log } = cell<string>(() =>
                ++n === 1
                    ? never()
                    : Promise.resolve({ kind: "ok", value: "measured" })
            );
            expect(await runCellAttempts(deps)).toEqual({
                kind: "ok",
                value: "measured",
            });
            expect(log.deadlines).toBe(1);
            expect(log.retries).toBe(1);
        },
        HANG_TIMEOUT
    );

    it(
        "a retry setup that never settles is bounded too, and the cell still ends",
        async () => {
            const { deps, log } = cell<number>(() => never(), {
                beforeRetry: () => never(),
            });
            const outcome = await runCellAttempts(deps);
            expect(outcome.kind).toBe("INFRA");
            expect(
                log.notes.filter((l) => l.startsWith("retry setup failed"))
            ).toHaveLength(POLICY.maxAttempts - 1);
        },
        HANG_TIMEOUT
    );

    it("an unrecognised failure is UNWALKED on the first attempt, no retry", async () => {
        const { deps, log } = cell<number>(async () => {
            throw new Error("the lobby offered no Resume");
        });
        expect(await runCellAttempts(deps)).toEqual({
            kind: "UNWALKED",
            reason: "the lobby offered no Resume",
        });
        expect(log.retries).toBe(0);
    });

    it("an attempt's own unwalked verdict is final", async () => {
        const { deps } = cell<number>(async () => ({
            kind: "unwalked",
            reason: "the measurement threw: boom",
        }));
        expect(await runCellAttempts(deps)).toEqual({
            kind: "UNWALKED",
            reason: "the measurement threw: boom",
        });
    });
});

describe("the cell-deadline signature", () => {
    it("classifies before the console: the deadline is a fact about the attempt", () => {
        expect(
            classifyWalkFailure({
                message: `${CELL_DEADLINE_MESSAGE_PREFIX}: attempt 1 at lobby @ phone did not finish within 180s`,
                consoleErrors: ["[CONVEX Q(x)] Server Error"],
            })
        ).toEqual({ kind: "INFRA", signature: "cell-deadline" });
    });

    it("stands as INFRA whatever the load; other signatures keep the threshold", () => {
        expect(standingVerdict(0.2, POLICY, "cell-deadline")).toBe("INFRA");
        expect(standingVerdict(0.2, POLICY, "step-timeout")).toBe("UNWALKED");
    });
});

describe("withDeadline", () => {
    it("settles with the work when the work is first", async () => {
        await expect(
            withDeadline(async () => 7, 1_000, "fast work")
        ).resolves.toBe(7);
    });

    it(
        "rejects with the deadline prefix after running onExpire",
        async () => {
            let expired = false;
            const err = await withDeadline(
                never,
                DEADLINE_MS,
                "slow work",
                () => {
                    expired = true;
                }
            ).catch((e: unknown) => e);
            expect(err).toBeInstanceOf(DeadlineExpired);
            expect((err as Error).message).toMatch(
                new RegExp(`^${CELL_DEADLINE_MESSAGE_PREFIX}: slow work`)
            );
            expect(expired).toBe(true);
        },
        HANG_TIMEOUT
    );
});

describe("the run deadline", () => {
    it(
        "rejects a pool with a stalled viewport, reports the open cells, and the fleet still tears down",
        async () => {
            const calls: string[] = [];
            const fleet = createLaneFleet({
                accounts: [newLaneAccount(), newLaneAccount()],
                host: newLaneAccount(),
                signUp: async (a) => `token-of-${a.runId}`,
                seedDeck: async (a) => `deck-of-${a.runId}`,
                seedJoinTable: async (a) => `table-of-${a.runId}`,
                keepUser: false,
                log: () => {},
                run: (fn) => {
                    calls.push(fn);
                    return fn.endsWith("sweepStaleLaneAccounts")
                        ? { swept: [] }
                        : null;
                },
            });
            const viewports = ["phone", "tablet", "desktop"];
            const progress = new Map<string, string>();
            const reported = new Set<string>();

            const err = await withLaneFleet(fleet, () =>
                withDeadline(
                    () =>
                        runPool(viewports, 2, async (id) => {
                            progress.set(
                                id,
                                id === "tablet" ? "lobby" : "board"
                            );
                            if (id === "tablet") await never();
                            reported.add(id);
                            return id;
                        }),
                    DEADLINE_MS * 3,
                    "the run"
                )
            ).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(DeadlineExpired);
            expect(openCellsLines(viewports, progress, reported)).toEqual([
                "  open: tablet       lobby",
            ]);
            expect(
                calls.filter((c) => c.endsWith("destroyLaneAccount"))
            ).toHaveLength(3);
        },
        HANG_TIMEOUT
    );

    it("lists a viewport that never started as not started", () => {
        expect(
            openCellsLines(["phone", "tablet"], new Map(), new Set(["phone"]))
        ).toEqual(["  open: tablet       not started"]);
    });
});

describe("deadlineFromEnv", () => {
    it("takes a positive number, else the default", () => {
        expect(deadlineFromEnv("5000", 1)).toBe(5000);
        expect(deadlineFromEnv(undefined, 1)).toBe(1);
        expect(deadlineFromEnv("0", 1)).toBe(1);
        expect(deadlineFromEnv("soon", 1)).toBe(1);
    });
});
