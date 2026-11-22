// The per-game Bot search report (issue #9526): its arithmetic, its device
// class, and the two promises its header makes — it carries nothing outside
// its allowlist, and it never costs the game anything.
//
// The driver-level behaviour (one report per game, however often the driver
// mounts on it: at game over, on leaving or on page hide) is proven through
// the real hook in
// `src/hooks/__tests__/useVsAiDriver-liveness.bot.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    REPORT_KEYS,
    acquireBotSearchReport,
    CALIBRATION_INTERVAL_MS,
    CALIBRATION_SKIP_OVERRUN_MS,
    CALIBRATION_WARMUP_READINGS,
    boardFacts,
    botSearchSink,
    calibrationLog,
    clearBotSearchReports,
    consultClock,
    coresBucket,
    deviceClass,
    engineFamily,
    openBotSearchReport,
    osFamily,
    percentile,
    summarizeBotSearch,
    type ConsultSample,
    type DeviceClass,
} from "../bot-search-telemetry";
import { botConsultSpanSink } from "../bot-consult-span";

const DEVICE: DeviceClass = {
    engine: "gecko",
    os: "linux",
    cores: "3-4",
    mobile: false,
};

function searched(
    overrides: Partial<ConsultSample> & {
        requested?: number;
        completed?: number;
        elapsedMs?: number;
        stoppedBy?: "iterations" | "time" | "settled";
        probes?: number;
    } = {}
): ConsultSample {
    const {
        requested = 400,
        completed = 400,
        elapsedMs = 500,
        stoppedBy = "iterations",
        probes = 1000,
        ...rest
    } = overrides;
    return {
        outcome: "move",
        via: "worker",
        consultMs: elapsedMs + 20,
        difficulty: "expert",
        search: {
            iterationsRequested: requested,
            iterationsCompleted: completed,
            elapsedMs,
            stoppedBy,
            rolloutProbes: probes,
        },
        ...rest,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    clearBotSearchReports();
});

describe("percentile (nearest rank)", () => {
    it("has no value for no samples", () => {
        expect(percentile([], 50)).toBeUndefined();
    });

    it("is the sample itself for one sample, at every percentile", () => {
        expect(percentile([42], 50)).toBe(42);
        expect(percentile([42], 90)).toBe(42);
    });

    it("reads the rank off the SORTED samples", () => {
        const samples = [9, 1, 5, 3, 7, 10, 2, 8, 4, 6];
        expect(percentile(samples, 50)).toBe(5);
        expect(percentile(samples, 90)).toBe(9);
        expect(percentile(samples, 100)).toBe(10);
    });
});

describe("the coarse device class", () => {
    it("names the engine family, and WebKit for every browser on iOS", () => {
        expect(
            engineFamily(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0"
            )
        ).toBe("gecko");
        expect(
            engineFamily(
                "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0"
            )
        ).toBe("chromium");
        expect(
            engineFamily(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15"
            )
        ).toBe("webkit");
        expect(
            engineFamily(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1"
            )
        ).toBe("webkit");
        expect(
            engineFamily(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15"
            )
        ).toBe("webkit");
        expect(engineFamily("")).toBe("other");
    });

    it("buckets the core count", () => {
        expect(coresBucket(undefined)).toBe("unknown");
        expect(coresBucket(0)).toBe("unknown");
        expect(coresBucket(2)).toBe("1-2");
        expect(coresBucket(4)).toBe("3-4");
        expect(coresBucket(8)).toBe("5-8");
        expect(coresBucket(12)).toBe("9+");
    });

    it("reads the navigator and returns ONLY the class", () => {
        const device = deviceClass({
            userAgent:
                "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
            hardwareConcurrency: 8,
        });
        expect(device).toEqual({
            engine: "chromium",
            os: "android",
            cores: "5-8",
            mobile: true,
        });
    });

    // Real agents (issue #10022). Safari and Firefox expose no
    // `userAgentData`, so for them the agent and the touch screen decide.
    const IPHONE_SAFARI =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
    /** What iPadOS Safari sends by default — and what an iPhone sends under
     *  "Request Desktop Website": the Mac agent, word for word. */
    const MAC_SAFARI =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
    const ANDROID_CHROME =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
    const DESKTOP_FIREFOX =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

    it("reads an iPhone in Safari as mobile", () => {
        expect(
            deviceClass({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })
        ).toMatchObject({ engine: "webkit", mobile: true });
    });

    it("reads a desktop Mac agent on a touch screen (iPadOS, desktop-site iPhone) as mobile", () => {
        expect(
            deviceClass({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })
        ).toMatchObject({ engine: "webkit", mobile: true });
    });

    it("reads a Mac in Safari as desktop", () => {
        expect(
            deviceClass({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })
        ).toMatchObject({ engine: "webkit", mobile: false });
    });

    it("reads Android Chrome as mobile, by its hint and by its agent", () => {
        expect(
            deviceClass({
                userAgent: ANDROID_CHROME,
                maxTouchPoints: 5,
                userAgentData: { mobile: true },
            })
        ).toMatchObject({ engine: "chromium", mobile: true });
        expect(
            deviceClass({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 }).mobile
        ).toBe(true);
    });

    it("reads desktop Firefox as desktop, touch screen or not", () => {
        expect(
            deviceClass({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0 })
        ).toMatchObject({ engine: "gecko", mobile: false });
        expect(
            deviceClass({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 10 })
                .mobile
        ).toBe(false);
    });

    // Issue #10128: which machine ran which engine.
    const LINUX_FIREFOX =
        "Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0";
    const MAC_CHROME =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const ANDROID_FIREFOX =
        "Mozilla/5.0 (Android 16; Mobile; rv:160.0) Gecko/160.0 Firefox/160.0";
    const CHROMEOS =
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

    it("reads the OS family off the user agent", () => {
        expect(osFamily({ userAgent: LINUX_FIREFOX })).toBe("linux");
        expect(osFamily({ userAgent: DESKTOP_FIREFOX })).toBe("windows");
        expect(osFamily({ userAgent: MAC_CHROME })).toBe("macos");
        expect(osFamily({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(
            "macos"
        );
        expect(osFamily({ userAgent: IPHONE_SAFARI })).toBe("ios");
        expect(osFamily({ userAgent: ANDROID_CHROME })).toBe("android");
        expect(osFamily({ userAgent: ANDROID_FIREFOX })).toBe("android");
        expect(osFamily({ userAgent: CHROMEOS })).toBe("other");
        expect(osFamily({ userAgent: "" })).toBe("other");
        expect(osFamily(undefined)).toBe("other");
    });

    it("reads a desktop Mac agent on a touch screen as iOS", () => {
        expect(osFamily({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe(
            "ios"
        );
    });

    it("prefers the browser's own platform hint over the user agent", () => {
        expect(
            osFamily({
                userAgent: MAC_CHROME,
                userAgentData: { platform: "Linux" },
            })
        ).toBe("linux");
        expect(
            osFamily({
                userAgent: LINUX_FIREFOX,
                userAgentData: { platform: "macOS" },
            })
        ).toBe("macos");
        expect(
            osFamily({
                userAgent: LINUX_FIREFOX,
                userAgentData: { platform: "Windows" },
            })
        ).toBe("windows");
        expect(
            osFamily({
                userAgent: LINUX_FIREFOX,
                userAgentData: { platform: "Android" },
            })
        ).toBe("android");
        expect(
            osFamily({
                userAgent: LINUX_FIREFOX,
                userAgentData: { platform: "Chrome OS" },
            })
        ).toBe("other");
    });

    it("falls back to the user agent on an empty or unknown platform hint", () => {
        expect(
            osFamily({ userAgent: MAC_CHROME, userAgentData: { platform: "" } })
        ).toBe("macos");
        expect(
            osFamily({
                userAgent: MAC_CHROME,
                userAgentData: { platform: "Unknown" },
            })
        ).toBe("macos");
    });

    it("prefers the browser's own mobile hint over the user-agent guess", () => {
        expect(
            deviceClass({
                userAgent: "Mozilla/5.0 (Linux; Android 16) Mobile",
                userAgentData: { mobile: false },
            }).mobile
        ).toBe(false);
    });
});

describe("summarizeBotSearch", () => {
    it("folds a game's consults into counters, ratios and percentiles", () => {
        const report = summarizeBotSearch(
            "game1",
            [
                searched({
                    requested: 1320,
                    completed: 1320,
                    elapsedMs: 1000,
                }),
                searched({
                    requested: 1320,
                    completed: 330,
                    elapsedMs: 3300,
                    stoppedBy: "time",
                }),
                searched({
                    requested: 1320,
                    completed: 200,
                    elapsedMs: 100,
                    stoppedBy: "settled",
                    via: "inline",
                }),
                {
                    outcome: "timeout",
                    via: "worker",
                    consultMs: 5000,
                    difficulty: "expert",
                },
            ],
            DEVICE
        );

        expect(report).toEqual({
            gameId: "game1",
            difficulty: "expert",
            consults: 4,
            "consults.move": 3,
            "consults.timeout": 1,
            "consults.inline": 1,
            searches: 3,
            "iterations.requested": 3960,
            "iterations.completed": 1850,
            "iterations.ratio": 0.467,
            "stopped.iterations": 1,
            "stopped.time": 1,
            "stopped.settled": 1,
            "searchMs.p50": 1000,
            "searchMs.p90": 3300,
            "searchMs.max": 3300,
            "consultMs.p50": 1020,
            "consultMs.p90": 5000,
            "consultMs.max": 5000,
            // 1000/1320 = 0.76, 3300/330 = 10, 100/200 = 0.5
            "msPerIteration.p50": 0.76,
            "msPerIteration.p90": 10,
            // The first search: 1000/1320.
            "msPerIteration.first": 0.76,
            // 1000 probes each: 1000/1320 = 0.8, 1000/330 = 3, 1000/200 = 5
            "probesPerIteration.p50": 3,
            // 1000/1000 = 1, 3300/1000 = 3.3, 100/1000 = 0.1
            "msPerProbe.p50": 1,
            "device.engine": "gecko",
            "device.os": "linux",
            "device.cores": "3-4",
            "device.mobile": false,
        });
    });

    it("leaves a statistic OUT when no sample stands behind it", () => {
        const report = summarizeBotSearch(
            "game1",
            [
                {
                    outcome: "worker-error",
                    via: "worker",
                    consultMs: 12,
                    difficulty: "medium",
                },
            ],
            DEVICE
        );
        expect(report.searches).toBe(0);
        expect(report).not.toHaveProperty("iterations.ratio");
        expect(report).not.toHaveProperty("searchMs.p50");
        expect(report).not.toHaveProperty("msPerIteration.p50");
        expect(report["consultMs.max"]).toBe(12);
    });

    it("does not divide by a search that completed no iteration", () => {
        const report = summarizeBotSearch(
            "game1",
            [searched({ completed: 0, elapsedMs: 1500, stoppedBy: "time" })],
            DEVICE
        );
        expect(report["iterations.ratio"]).toBe(0);
        expect(report).not.toHaveProperty("msPerIteration.p50");
    });

    it("reads the early-board speed off the game's FIRST search, however the later ones went", () => {
        const report = summarizeBotSearch(
            "game1",
            [
                // A consult with no search, then one that completed nothing:
                // neither is a reading.
                {
                    outcome: "worker-error",
                    via: "worker",
                    consultMs: 12,
                    difficulty: "expert",
                },
                searched({ completed: 0, elapsedMs: 3300, stoppedBy: "time" }),
                searched({
                    completed: 300,
                    elapsedMs: 3300,
                    stoppedBy: "time",
                }),
                searched({ completed: 30, elapsedMs: 3300, stoppedBy: "time" }),
                searched({ completed: 20, elapsedMs: 3300, stoppedBy: "time" }),
            ],
            DEVICE
        );
        expect(report["msPerIteration.first"]).toBe(11);
        expect(report["msPerIteration.p50"]).toBe(110);
    });

    it("leaves the early-board speed out when no search completed an iteration", () => {
        const report = summarizeBotSearch(
            "game1",
            [searched({ completed: 0, elapsedMs: 1500, stoppedBy: "time" })],
            DEVICE
        );
        expect(report).not.toHaveProperty("msPerIteration.first");
    });

    it("says `mixed` when the game's consults ran at more than one preset", () => {
        const report = summarizeBotSearch(
            "game1",
            [searched(), searched({ difficulty: "hard" })],
            DEVICE
        );
        expect(report.difficulty).toBe("mixed");
    });

    it("carries no attribute outside the allowlist, whatever the consults were", () => {
        const outcomes = [
            "move",
            "no-move",
            "search-error",
            "worker-error",
            "timeout",
        ] as const;
        const stops = ["iterations", "time", "settled"] as const;
        const samples = outcomes.flatMap((outcome) =>
            stops.map((stoppedBy) =>
                searched({ outcome, stoppedBy, via: "inline", idleMs: 4000 })
            )
        );
        const report = summarizeBotSearch("game1", samples, DEVICE, [2.1, 3.4]);
        const allowed = new Set<string>(REPORT_KEYS);
        expect(Object.keys(report).filter((k) => !allowed.has(k))).toEqual([]);
        // Every key the allowlist names is reachable: none is dead weight.
        expect(Object.keys(report).sort()).toEqual([...REPORT_KEYS].sort());
    });

    it("drops an attribute the allowlist does not name, at runtime", () => {
        // An outcome or stop reason added to its union later (or a malformed
        // trace) builds a counter key nobody reviewed.
        const report = summarizeBotSearch(
            "game1",
            [
                searched({
                    outcome: "brand-new-outcome" as never,
                    stoppedBy: "brand-new-stop" as never,
                }),
            ],
            DEVICE
        );
        expect(report).not.toHaveProperty("consults.brand-new-outcome");
        expect(report).not.toHaveProperty("stopped.brand-new-stop");
        expect(report.consults).toBe(1);
    });

    it("treats a search whose clock ran backwards as no sample", () => {
        const report = summarizeBotSearch(
            "game1",
            [searched({ elapsedMs: 800 }), searched({ elapsedMs: -40 })],
            DEVICE
        );
        expect(report.searches).toBe(1);
        expect(report["searchMs.max"]).toBe(800);
        expect(report["msPerIteration.p50"]).toBe(2);
    });

    it("treats a number that is not finite as no sample", () => {
        const report = summarizeBotSearch(
            "game1",
            [
                searched({ elapsedMs: 800 }),
                searched({ elapsedMs: Number.NaN }),
                { ...searched(), consultMs: Number.POSITIVE_INFINITY },
            ],
            DEVICE
        );
        expect(report.consults).toBe(3);
        expect(report.searches).toBe(2);
        expect(report["consultMs.max"]).toBe(820);
        for (const value of Object.values(report)) {
            if (typeof value === "number") {
                expect(Number.isFinite(value)).toBe(true);
            }
        }
    });
});

describe("what a slow game was (issue #10321)", () => {
    it("reads the probes per iteration and the time per probe at the median", () => {
        const report = summarizeBotSearch(
            "game1",
            [
                // 60 probes an iteration at 1 ms each: a costly board.
                searched({ completed: 50, elapsedMs: 3000, probes: 3000 }),
                // 5 probes an iteration at 3 ms each: a slow machine.
                searched({ completed: 200, elapsedMs: 3000, probes: 1000 }),
                searched({ completed: 100, elapsedMs: 3000, probes: 1500 }),
            ],
            DEVICE
        );
        expect(report["probesPerIteration.p50"]).toBe(15);
        expect(report["msPerProbe.p50"]).toBe(2);
    });

    it("leaves both out when no search counted a probe", () => {
        const unprobed = searched();
        delete unprobed.search!.rolloutProbes;
        const report = summarizeBotSearch(
            "game1",
            [unprobed, searched({ probes: 0 })],
            DEVICE
        );
        expect(report).not.toHaveProperty("probesPerIteration.p50");
        expect(report).not.toHaveProperty("msPerProbe.p50");
    });

    it("reads the idle time between consults at the median, and leaves it out with no reading", () => {
        const idle = summarizeBotSearch(
            "game1",
            [
                searched(),
                searched({ idleMs: 22_000 }),
                searched({ idleMs: 4_000 }),
                searched({ idleMs: 31_000 }),
                // Not a reading: a clock that ran backwards, and no number.
                searched({ idleMs: -5 }),
                searched({ idleMs: Number.NaN }),
            ],
            DEVICE
        );
        expect(idle["idleMs.p50"]).toBe(22_000);
        // A consult that never searched still had an idle time before it.
        const unsearched = summarizeBotSearch(
            "game1",
            [
                {
                    outcome: "timeout",
                    via: "worker",
                    consultMs: 5000,
                    difficulty: "expert",
                    idleMs: 900,
                },
            ],
            DEVICE
        );
        expect(unsearched["idleMs.p50"]).toBe(900);
        expect(
            summarizeBotSearch("game1", [searched()], DEVICE)
        ).not.toHaveProperty("idleMs.p50");
    });

    it("counts a board and returns nothing else of it", () => {
        const facts = boardFacts({
            turn: 7,
            phase: "DECLARE_BLOCKERS",
            players: [
                { battlefield: [{ id: "a" }, { id: "b" }, { id: "c" }] },
                { battlefield: [{ id: "d" }] },
            ],
        });
        expect(facts).toEqual({
            turn: 7,
            phase: "DECLARE_BLOCKERS",
            permanents: 4,
        });
        expect(boardFacts({ phase: "UPKEEP" })).toBeUndefined();
        expect(
            boardFacts({ turn: 1, phase: "UPKEEP", players: [null as never] })
        ).toBeUndefined();
    });
});

describe("the calibration readings (issue #10451)", () => {
    /** Let the promises a calibration settles through run. */
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("reports the game's first reading, its latest, its best and their count, and none of them with none", () => {
        const report = summarizeBotSearch(
            "game1",
            [searched()],
            DEVICE,
            [9.9049, 1.7349, 3.4151]
        );
        expect(report["calibration.first"]).toBe(9.9);
        expect(report["calibration.last"]).toBe(3.42);
        expect(report["calibration.min"]).toBe(1.73);
        expect(report["calibration.count"]).toBe(3);

        const none = summarizeBotSearch("game1", [searched()], DEVICE, []);
        expect(none).not.toHaveProperty("calibration.first");
        expect(none).not.toHaveProperty("calibration.last");
        expect(none).not.toHaveProperty("calibration.min");
        expect(none).not.toHaveProperty("calibration.count");
        const noNumber = summarizeBotSearch("game1", [searched()], DEVICE, [
            Number.NaN,
        ]);
        expect(noNumber).not.toHaveProperty("calibration.first");
    });

    it("asks after each of the game's first consults, then only once the interval has passed", async () => {
        const calibrate = vi.fn(() => Promise.resolve(2.5));
        const log = calibrationLog(calibrate);

        // The warm-up: one reading after each of the first consults, however
        // close together they come.
        for (let i = 0; i < CALIBRATION_WARMUP_READINGS; i++) {
            log.after(searched(), 1_000 + i);
            await settled();
        }
        expect(calibrate).toHaveBeenCalledTimes(CALIBRATION_WARMUP_READINGS);
        expect(log.readings()).toHaveLength(CALIBRATION_WARMUP_READINGS);
        const lastAsked = 1_000 + CALIBRATION_WARMUP_READINGS - 1;

        // Then too soon: a consult a second later asks for nothing.
        log.after(searched(), lastAsked + 1_000);
        log.after(searched(), lastAsked + CALIBRATION_INTERVAL_MS - 1);
        expect(calibrate).toHaveBeenCalledTimes(CALIBRATION_WARMUP_READINGS);

        calibrate.mockReturnValue(Promise.resolve(7.5));
        log.after(searched(), lastAsked + CALIBRATION_INTERVAL_MS);
        expect(calibrate).toHaveBeenCalledTimes(
            CALIBRATION_WARMUP_READINGS + 1
        );
        await settled();
        expect(log.readings().at(-1)).toBe(7.5);
    });

    it("never asks after the in-thread fallback, nor behind a Worker that gave no answer", () => {
        const calibrate = vi.fn(() => Promise.resolve(2.5));
        const log = calibrationLog(calibrate);
        log.after(searched({ via: "inline" }), 1_000);
        for (const outcome of [
            "timeout",
            "worker-error",
            "search-error",
        ] as const) {
            log.after({ ...searched(), outcome }, 1_000);
        }
        expect(calibrate).not.toHaveBeenCalled();
        // The first consult the Worker does answer gets the game's first.
        log.after(searched({ outcome: "no-move" }), 1_000);
        expect(calibrate).toHaveBeenCalledTimes(1);
    });

    it("asks for none after a search whose last iteration ran long past its cap", () => {
        const calibrate = vi.fn(() => Promise.resolve(2.5));
        const log = calibrationLog(calibrate);
        const capped = (elapsedMs: number, budgetMs?: number) => ({
            ...searched({ elapsedMs, stoppedBy: "time" }),
            ...(budgetMs === undefined ? {} : { budgetMs }),
        });
        // One iteration of 400 ms past an 8.3 s cap: the next consult may
        // need the timeout's whole margin.
        log.after(capped(8300 + CALIBRATION_SKIP_OVERRUN_MS + 100, 8300), 0);
        // A time-stopped search with no known cap cannot be judged.
        log.after(capped(8400), 0);
        expect(calibrate).not.toHaveBeenCalled();
        // An ordinary capped search: its last iteration ended 40 ms past.
        log.after(capped(8340, 8300), 0);
        expect(calibrate).toHaveBeenCalledTimes(1);
    });

    it("says how long a consult posted during a calibration waited behind it", async () => {
        let now = 0;
        let release!: (reading: number | null) => void;
        const log = calibrationLog(
            () =>
                new Promise<number | null>((resolve) => {
                    release = resolve;
                }),
            () => now
        );
        // Nothing asked yet: nobody waits.
        expect(log.waitedBehind(500, 900)).toBe(0);

        log.after(searched(), 1_000);
        // Still in flight when the consult was answered: it waited throughout.
        expect(log.waitedBehind(1_010, 1_050)).toBe(40);
        now = 1_040;
        release(2.5);
        await settled();
        // Posted at 1010, the calibration ended at 1040: 30 ms behind it.
        expect(log.waitedBehind(1_010, 4_000)).toBe(30);
        // Posted before it was asked for, or after it ended: none.
        expect(log.waitedBehind(900, 4_000)).toBe(0);
        expect(log.waitedBehind(1_040, 4_000)).toBe(0);
    });

    it("takes the wait behind a calibration out of the consult's time, and gives it no idle reading", async () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const span = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        const calibration = calibrationLog(() => Promise.resolve(2.5));
        // The consult below was posted at 5010 and answered at 5510; the
        // calibration in flight at 5010 kept the Worker for 30 ms of that.
        vi.spyOn(calibration, "waitedBehind").mockImplementation((postedAt) =>
            postedAt === 5_010 ? 30 : 0
        );
        const report = openBotSearchReport(
            "game1",
            undefined,
            undefined,
            calibration
        );
        report.record({ ...searched(), postedAt: 1_000, consultMs: 4_000 });
        report.record({ ...searched(), postedAt: 5_010, consultMs: 500 });
        report.record({ ...searched(), postedAt: 6_000, consultMs: 100 });
        report.flush();

        const second = span.mock.calls[1]![0];
        expect(second.consultMs).toBe(470);
        expect(second).not.toHaveProperty("idleMs");
        // The next consult's idle time still starts at the real answer.
        expect(span.mock.calls[2]![0]).toMatchObject({ idleMs: 490 });
        expect(log.mock.calls[0]![0]).toMatchObject({ "consultMs.p50": 470 });
    });

    it("swallows a calibration log that throws, and still folds the consult in", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        vi.spyOn(botConsultSpanSink, "record").mockImplementation(() => {});
        const broken = calibrationLog();
        broken.after = () => {
            throw new Error("the log is broken");
        };
        const report = openBotSearchReport(
            "game1",
            undefined,
            undefined,
            broken
        );
        expect(() => report.record(searched())).not.toThrow();
        report.flush();
        expect(log.mock.calls[0]![0]).toMatchObject({ consults: 1 });
    });

    it("asks for one reading at a time", async () => {
        let release!: (reading: number | null) => void;
        const calibrate = vi.fn(
            () =>
                new Promise<number | null>((resolve) => {
                    release = resolve;
                })
        );
        const log = calibrationLog(calibrate);
        log.after(searched(), 0);
        // Long past the interval, and the first is still in flight.
        log.after(searched(), 10 * CALIBRATION_INTERVAL_MS);
        expect(calibrate).toHaveBeenCalledTimes(1);
        release(4);
        await settled();
        log.after(searched(), 20 * CALIBRATION_INTERVAL_MS);
        expect(calibrate).toHaveBeenCalledTimes(2);
    });

    it("keeps no reading that is not a positive number", async () => {
        for (const reading of [null, 0, -1, Number.NaN]) {
            const log = calibrationLog(() => Promise.resolve(reading));
            log.after(searched(), 0);
            await settled();
            expect(log.readings()).toEqual([]);
        }
    });

    it("swallows a calibration that throws or rejects, and asks again later", async () => {
        const calibrate = vi
            .fn<() => Promise<number | null>>()
            .mockImplementationOnce(() => {
                throw new Error("no Worker");
            })
            .mockImplementationOnce(() => Promise.reject(new Error("died")))
            .mockImplementation(() => Promise.resolve(3));
        const log = calibrationLog(calibrate);
        expect(() => log.after(searched(), 0)).not.toThrow();
        expect(() =>
            log.after(searched(), CALIBRATION_INTERVAL_MS)
        ).not.toThrow();
        await settled();
        log.after(searched(), 2 * CALIBRATION_INTERVAL_MS);
        await settled();
        expect(calibrate).toHaveBeenCalledTimes(3);
        expect(log.readings()).toEqual([3]);
    });

    it("stays empty and asks nobody when there is no Worker to ask", () => {
        const log = calibrationLog();
        expect(() => log.after(searched(), 0)).not.toThrow();
        expect(log.readings()).toEqual([]);
    });

    it("puts the game's readings on its report and the latest on each later span", async () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const span = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        const report = openBotSearchReport(
            "game1",
            undefined,
            undefined,
            calibrationLog(() => Promise.resolve(2.5))
        );
        report.record(searched());
        await settled();
        report.record(searched());
        report.flush();

        expect(span.mock.calls[0]![0]).not.toHaveProperty("calibration");
        expect(span.mock.calls[1]![0]).toMatchObject({ calibration: 2.5 });
        expect(log.mock.calls[0]![0]).toMatchObject({
            "calibration.first": 2.5,
            "calibration.last": 2.5,
            "calibration.min": 2.5,
            "calibration.count": 1,
        });
    });
});

describe("consultClock", () => {
    const at = (postedAt: number, consultMs: number): ConsultSample => ({
        ...searched(),
        postedAt,
        consultMs,
    });

    it("numbers a game's consults and reads the idle time before each", () => {
        const clock = consultClock();
        // Posted at 1000, answered at 4000.
        const first = clock(at(1000, 3000));
        // Posted at 26000: 22 s after the first answer.
        const second = clock(at(26_000, 500));
        const third = clock(at(26_800, 100));

        expect(first.ordinal).toBe(1);
        expect(first).not.toHaveProperty("idleMs");
        expect(second.ordinal).toBe(2);
        expect(second.idleMs).toBe(22_000);
        expect(third.ordinal).toBe(3);
        expect(third.idleMs).toBe(300);
    });

    it("has no idle reading across a consult it could not date", () => {
        const clock = consultClock();
        clock(at(1000, 3000));
        // No post time: this consult has no reading, and neither has the next.
        const undated = clock(searched());
        const after = clock(at(9000, 100));
        expect(undated).not.toHaveProperty("idleMs");
        expect(after).not.toHaveProperty("idleMs");
        expect(after.ordinal).toBe(3);
    });

    it("has no idle reading after a consult the Worker did not answer, or one that ran in-thread", () => {
        // After a timeout or a failure the Worker may still be searching;
        // after an in-thread consult it was never known to be idle.
        for (const unanswered of [
            { outcome: "timeout" as const },
            { outcome: "worker-error" as const },
            { outcome: "search-error" as const },
            { via: "inline" as const },
        ]) {
            const clock = consultClock();
            clock({ ...at(1000, 3000), ...unanswered });
            expect(clock(at(9000, 100))).not.toHaveProperty("idleMs");
            // The consult after that one follows a Worker's answer again.
            expect(clock(at(10_000, 100)).idleMs).toBe(900);
        }
    });

    it("keeps its own reading over a caller's", () => {
        const clock = consultClock();
        expect(clock({ ...at(1000, 10), idleMs: 77 })).not.toHaveProperty(
            "idleMs"
        );
        expect(clock({ ...at(2000, 10), idleMs: 77 }).idleMs).toBe(990);
    });
});

describe("openBotSearchReport", () => {
    it("records one span per consult, timed by the game's clock, and folds the idle time into the report", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const span = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        const report = openBotSearchReport("game1");
        report.record({ ...searched(), postedAt: 1000, consultMs: 3000 });
        report.record({ ...searched(), postedAt: 26_000, consultMs: 500 });
        report.flush();

        expect(span).toHaveBeenCalledTimes(2);
        expect(span.mock.calls[0]![0]).toMatchObject({
            gameId: "game1",
            consult: 1,
        });
        expect(span.mock.calls[1]![0]).toMatchObject({
            gameId: "game1",
            consult: 2,
            idleMs: 22_000,
        });
        expect(log.mock.calls[0]![0]).toMatchObject({ "idleMs.p50": 22_000 });
    });

    it("still records a consult's span after the report went out", () => {
        vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const span = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        const report = openBotSearchReport("game1");
        report.record(searched());
        report.flush();
        report.record(searched());
        expect(span).toHaveBeenCalledTimes(2);
        expect(span.mock.calls[1]![0]).toMatchObject({ consult: 2 });
    });

    it("swallows a throwing clock, and still folds the consult in", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const report = openBotSearchReport("game1", undefined, () => {
            throw new Error("the clock is broken");
        });
        expect(() => report.record(searched())).not.toThrow();
        report.flush();
        expect(log.mock.calls[0]![0]).toMatchObject({ consults: 1 });
    });

    it("swallows a throwing span sink, and still folds the consult in", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        vi.spyOn(botConsultSpanSink, "record").mockImplementation(() => {
            throw new Error("tracing is down");
        });
        const report = openBotSearchReport("game1");
        expect(() => report.record(searched())).not.toThrow();
        report.flush();
        expect(log.mock.calls[0]![0]).toMatchObject({ consults: 1 });
    });

    it("emits one report, once, and ignores what arrives after it", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const report = openBotSearchReport("game1");
        report.record(searched());
        report.flush();
        report.record(searched());
        report.flush();

        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]![0]).toMatchObject({
            gameId: "game1",
            consults: 1,
        });
    });

    it("emits nothing for a game the Brain was never consulted in", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        openBotSearchReport("game1").flush();
        expect(log).not.toHaveBeenCalled();
    });

    it("stays open after a flush that had nothing to report", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const report = openBotSearchReport("game1");
        report.flush();
        report.record(searched());
        report.flush();
        expect(log).toHaveBeenCalledTimes(1);
    });

    it("forces the SDK's log buffer out right after the report (issue #10320)", () => {
        const order: string[] = [];
        vi.spyOn(botSearchSink, "log").mockImplementation(() => {
            order.push("log");
        });
        const flush = vi
            .spyOn(botSearchSink, "flush")
            .mockImplementation(() => {
                order.push("flush");
                return Promise.resolve(true);
            });
        const report = openBotSearchReport("game1");
        report.record(searched());
        report.flush();
        report.flush();

        expect(flush).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["log", "flush"]);
    });

    it("swallows a throwing or rejecting flush", async () => {
        vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const flush = vi
            .spyOn(botSearchSink, "flush")
            .mockImplementation(() => {
                throw new Error("transport is down");
            });
        const throwing = openBotSearchReport("game1");
        throwing.record(searched());
        expect(() => throwing.flush()).not.toThrow();

        flush.mockImplementation(() => Promise.reject(new Error("offline")));
        const rejecting = openBotSearchReport("game2");
        rejecting.record(searched());
        expect(() => rejecting.flush()).not.toThrow();
        // A rejection left unhandled would fail the run on the next tick.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(flush).toHaveBeenCalledTimes(2);
    });

    it("swallows a throwing sink", () => {
        vi.spyOn(botSearchSink, "log").mockImplementation(() => {
            throw new Error("monitoring is down");
        });
        const report = openBotSearchReport("game1");
        report.record(searched());
        expect(() => report.flush()).not.toThrow();
    });
});

describe("a game already reported (issue #10321)", () => {
    it("adds nothing to a report and still records each consult's span, numbered on", () => {
        const log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
        const span = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        const first = acquireBotSearchReport("game1");
        first.record(searched());
        first.flush();
        // The driver mounts on the same game again: its report has gone out.
        acquireBotSearchReport("game2");
        const again = acquireBotSearchReport("game1");
        again.record(searched());
        again.flush();

        expect(log).toHaveBeenCalledTimes(1);
        expect(span).toHaveBeenCalledTimes(2);
        expect(span.mock.calls[1]![0]).toMatchObject({
            gameId: "game1",
            consult: 2,
        });
    });
});
