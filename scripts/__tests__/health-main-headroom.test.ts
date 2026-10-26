import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAgent } from "std-env";
import { join } from "node:path";
import {
    collectDurations,
    collectFileWalls,
    DurationReporter,
    durationReporterOption,
    type DurationModule,
} from "../lib/vitest-duration-reporter";
import {
    DURATIONS_ENV,
    formatHeadroomView,
    headroomLine,
    headroomRatio,
    headroomView,
    parseDurationFile,
    readDurations,
    readFileWalls,
    readHeadroomRun,
    worstPerTest,
    type TestDuration,
} from "../lib/test-headroom";
import { parseHealthLogRed } from "../lib/telemetry-latency";

/**
 * Test timeout headroom (issue #5484): per-test duration against its
 * `testTimeout`, MEASURED by the health gate and never asserted. These tests
 * pin the reporter seam (what one vitest invocation writes), the ingest seam
 * (what a sealed run directory reads back as) and the report — never a
 * duration of their own.
 */
const FIXTURE = join(__dirname, "fixtures/headroom-65ab8337");

const DIFFICULTY =
    "convex/gre/__tests__/difficulty.bot.test.ts > difficulty — a higher preset plays measurably better (issue #114) > the expert preset is not weaker than hard on the same forced tactic";
const FETCHLAND =
    "convex/gre/__tests__/fetchland-valuation.bot.test.ts > fetch charter search convergence (issue #1499) > cracks the Delta on every registry seed at 1600 iterations";

function rec(over: Partial<TestDuration>): TestDuration {
    return {
        test: "a.test.ts > a",
        project: "node-engine",
        durationMs: 1000,
        timeoutMs: 30_000,
        state: "passed",
        ...over,
    };
}

/** A plain-object stand-in for vitest's `TestModule`. */
function fakeModule(
    moduleId: string,
    project: string,
    testTimeout: number,
    tests: Array<{
        name: string;
        duration?: number;
        timeout?: number;
        state?: string;
    }>
): DurationModule {
    return {
        moduleId,
        project: { name: project, config: { testTimeout } },
        children: {
            *allTests() {
                for (const t of tests)
                    yield {
                        fullName: t.name,
                        options: { timeout: t.timeout },
                        result: () => ({ state: t.state ?? "passed" }),
                        diagnostic: () =>
                            t.duration === undefined
                                ? undefined
                                : { duration: t.duration },
                    };
            },
        },
    };
}

describe("the reporter seam — collectDurations", () => {
    it("records file, full name, project and the project's testTimeout", () => {
        const out = collectDurations(
            [
                fakeModule("/repo/convex/x.bot.test.ts", "bot-node", 60_000, [
                    { name: "suite > slow", duration: 30_000.4 },
                ]),
            ],
            "/repo"
        );
        expect(out).toEqual([
            {
                test: "convex/x.bot.test.ts > suite > slow",
                project: "bot-node",
                durationMs: 30_000,
                timeoutMs: 60_000,
                state: "passed",
            },
        ]);
    });

    it("a test's own timeout beats its project's", () => {
        const [r] = collectDurations(
            [
                fakeModule("/repo/a.test.ts", "node-engine", 30_000, [
                    { name: "long", duration: 20_000, timeout: 120_000 },
                ]),
            ],
            "/repo"
        );
        expect(r.timeoutMs).toBe(120_000);
    });

    it("drops tests below the floor and tests that never ran", () => {
        const out = collectDurations(
            [
                fakeModule("/repo/a.test.ts", "node-engine", 30_000, [
                    { name: "fast", duration: 2_999 }, // 9.99%
                    { name: "at floor", duration: 3_000 }, // 10%
                    { name: "skipped" },
                ]),
            ],
            "/repo"
        );
        expect(out.map((r) => r.test)).toEqual(["a.test.ts > at floor"]);
    });

    it("onTestRunEnd writes one file the ingest reads back", () => {
        const dir = mkdtempSync(join(tmpdir(), "headroom-reporter-"));
        try {
            new DurationReporter(dir, "/repo").onTestRunEnd([
                fakeModule("/repo/b.test.ts", "dom", 30_000, [
                    { name: "x", duration: 24_000, state: "failed" },
                ]),
            ] as never);
            expect(readdirSync(dir)).toHaveLength(1);
            expect(readDurations(dir)).toEqual([
                {
                    test: "b.test.ts > x",
                    project: "dom",
                    durationMs: 24_000,
                    timeoutMs: 30_000,
                    state: "failed",
                },
            ]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    /** `fakeModule` plus the module-level diagnostic vitest gives a
     *  `TestModule` (issue #6943). */
    const withWall = (
        m: DurationModule,
        phases: number[],
        state = "passed"
    ): DurationModule => ({
        ...m,
        state: () => state,
        diagnostic: () => ({
            environmentSetupDuration: phases[0],
            prepareDuration: phases[1],
            collectDuration: phases[2],
            setupDuration: phases[3],
            duration: phases[4],
        }),
    });

    it("records each bot file's wall — every phase, whatever its share of a budget (issue #6943)", () => {
        const out = collectFileWalls(
            [
                // A census: 3 ms of assertions, 1.9 s of import.
                withWall(
                    fakeModule(
                        "/repo/convex/c.bot.test.ts",
                        "bot-node",
                        60_000,
                        [{ name: "t", duration: 3 }]
                    ),
                    [10, 20, 1_900, 5, 3.4]
                ),
                withWall(
                    fakeModule(
                        "/repo/src/d.bot.test.tsx",
                        "bot-dom",
                        60_000,
                        []
                    ),
                    [100, 0, 50, 0, 0],
                    "failed"
                ),
                // Not a bot project: the lane never admits it by cost.
                withWall(
                    fakeModule(
                        "/repo/convex/e.test.ts",
                        "node-engine",
                        30_000,
                        []
                    ),
                    [1, 1, 1, 1, 1]
                ),
            ],
            "/repo"
        );
        expect(out).toEqual([
            {
                file: "convex/c.bot.test.ts",
                project: "bot-node",
                wallMs: 1_938,
                state: "passed",
            },
            {
                file: "src/d.bot.test.tsx",
                project: "bot-dom",
                wallMs: 150,
                state: "failed",
            },
        ]);
    });

    it("onTestRunEnd writes the file walls the cost table reads back", () => {
        const dir = mkdtempSync(join(tmpdir(), "headroom-reporter-"));
        try {
            new DurationReporter(dir, "/repo").onTestRunEnd([
                withWall(
                    fakeModule("/repo/x.bot.test.ts", "bot-node", 60_000, []),
                    [0, 0, 700, 0, 12]
                ),
            ] as never);
            expect(readFileWalls(dir)).toEqual([
                {
                    file: "x.bot.test.ts",
                    project: "bot-node",
                    wallMs: 712,
                    state: "passed",
                },
            ]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("is added beside the default reporter only when health names a directory", () => {
        expect(durationReporterOption({})).toEqual({});
        const opt = durationReporterOption({ [DURATIONS_ENV]: "/tmp/d" });
        expect(opt.reporters?.[0]).toBe(isAgent ? "agent" : "default");
        expect(opt.reporters?.[1]).toBeInstanceOf(DurationReporter);
    });
});

describe("the ingest seam — parsing and the ratio", () => {
    it("the ratio is duration over budget", () => {
        expect(headroomRatio({ durationMs: 30_000, timeoutMs: 60_000 })).toBe(
            0.5
        );
        expect(headroomRatio({ durationMs: 5, timeoutMs: 0 })).toBe(0);
    });

    it("a malformed file or row is dropped, never thrown", () => {
        expect(parseDurationFile("not json")).toEqual([]);
        expect(parseDurationFile('{"records": 3}')).toEqual([]);
        expect(
            parseDurationFile(
                JSON.stringify({
                    version: 1,
                    records: [rec({}), { test: "x" }, rec({ timeoutMs: 0 })],
                })
            )
        ).toEqual([rec({})]);
    });

    it("a timeout then a green retry keeps the timeout — the near-miss", () => {
        const timedOut = rec({ durationMs: 60_000, state: "failed" });
        const retry = rec({ durationMs: 20_000 });
        expect(worstPerTest([timedOut, retry])).toEqual([timedOut]);
        expect(worstPerTest([retry, timedOut])).toEqual([timedOut]);
    });

    it("an unsealed run directory is not read", () => {
        const dir = mkdtempSync(join(tmpdir(), "headroom-run-"));
        try {
            expect(readHeadroomRun(dir, "abcdefabcdef")).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("the report — the 65ab8337 fixture", () => {
    const run = readHeadroomRun(FIXTURE, "65ab8337aaaa");

    it("reads the sealed run with its machine", () => {
        expect(run?.machine).toBe("MacBook-Pro");
        expect(run?.records).toHaveLength(4);
    });

    it("the view lists both tests that timed out, worst first, and only them", () => {
        const view = headroomView([run!]);
        expect(view.map((r) => r.test)).toEqual([FETCHLAND, DIFFICULTY]);
        expect(view.map((r) => r.project)).toEqual(["bot-node", "bot-node"]);
        expect(view[0].ratio).toBeCloseTo(83_000 / 60_000);
        expect(view[0].machine).toBe("MacBook-Pro");
        const text = formatHeadroomView(view, 1);
        expect(text).toContain("138%");
        expect(text).toContain("122%");
        expect(text).toContain("MacBook-Pro @ 65ab8337");
    });

    it("across runs, each test keeps its worst ratio and counts its runs over", () => {
        const later = {
            sha12: "0123456789ab",
            machine: "huawei",
            ts: 1760000100,
            records: [
                rec({
                    test: DIFFICULTY,
                    project: "bot-node",
                    durationMs: 90_000,
                    timeoutMs: 60_000,
                }),
            ],
        };
        const view = headroomView([run!, later]);
        expect(view[0]).toMatchObject({
            test: DIFFICULTY,
            machine: "huawei",
            sha12: "0123456789ab",
            runsOver: 2,
        });
        expect(view[1]).toMatchObject({ test: FETCHLAND, runsOver: 1 });
    });

    it("the log's headroom line names both", () => {
        const line = headroomLine(run!.records);
        expect(line).toMatch(/^headroom: 2 test\(s\) above 50%/);
        expect(line).toContain(`${FETCHLAND} [bot-node] 83.0s/60.0s = 138%`);
        expect(line).toContain(`${DIFFICULTY} [bot-node] 73.4s/60.0s = 122%`);
    });

    it("no line when nothing is above the threshold", () => {
        expect(headroomLine([rec({ durationMs: 15_000 })])).toBeNull();
    });
});

describe("the headroom line is advisory — the verdict never reads it", () => {
    const GREEN_LOG = "===== bun run test (exit 0) =====\n";
    const RED_LOG = "===== bun run test (exit 1) =====\n";

    it("a green log stays green and a red one red, line or no line", () => {
        const line = headroomLine([
            rec({ durationMs: 59_000, timeoutMs: 60_000 }),
        ])!;
        expect(parseHealthLogRed(`${GREEN_LOG}${line}\n`)).toBe(
            parseHealthLogRed(GREEN_LOG)
        );
        expect(parseHealthLogRed(`${RED_LOG}${line}\n`)).toBe(
            parseHealthLogRed(RED_LOG)
        );
    });

    it("a test named like a step exit cannot turn a green log red", () => {
        const line = headroomLine([
            rec({ test: "a.test.ts > reports (exit 1)", durationMs: 29_000 }),
        ])!;
        expect(parseHealthLogRed(`${GREEN_LOG}${line}\n`)).toBe(false);
    });
});
