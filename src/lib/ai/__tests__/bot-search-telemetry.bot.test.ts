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
    botSearchSink,
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
    } = {}
): ConsultSample {
    const {
        requested = 400,
        completed = 400,
        elapsedMs = 500,
        stoppedBy = "iterations",
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
        },
        ...rest,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
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
                searched({ outcome, stoppedBy, via: "inline" })
            )
        );
        const report = summarizeBotSearch("game1", samples, DEVICE);
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

describe("openBotSearchReport", () => {
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

    it("swallows a throwing sink", () => {
        vi.spyOn(botSearchSink, "log").mockImplementation(() => {
            throw new Error("monitoring is down");
        });
        const report = openBotSearchReport("game1");
        report.record(searched());
        expect(() => report.flush()).not.toThrow();
    });
});
