// Issue #8732: the game-end Verdict Proposal sample reports where it ended up
// to a sink a maintainer can read (Sentry in the app), not to the console
// only — production console output never left the tester's browser.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    proposalCountsReport,
    reportNoDecisionCaptured,
    reportProposalCounts,
    reportSampleFailed,
    type TelemetrySink,
    type VerdictProposalReport,
} from "../verdict-proposal-telemetry";

type Logged = {
    level: "info" | "warn";
    message: string;
    attributes: VerdictProposalReport;
};

function recordingSink(): {
    sink: TelemetrySink;
    logs: Logged[];
    exceptions: { cause: unknown; gameId: string }[];
} {
    const logs: Logged[] = [];
    const exceptions: { cause: unknown; gameId: string }[] = [];
    return {
        logs,
        exceptions,
        sink: {
            log: (level, message, attributes) =>
                logs.push({ level, message, attributes }),
            exception: (cause, gameId) => exceptions.push({ cause, gameId }),
        },
    };
}

const throwingSink: TelemetrySink = {
    log: () => {
        throw new Error("sdk down");
    },
    exception: () => {
        throw new Error("sdk down");
    },
};

describe("verdict proposal telemetry (issue #8732)", () => {
    beforeEach(() => {
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reports the counts and each consult outcome, nothing else", () => {
        const report = proposalCountsReport(
            "g1",
            { proposals: [], captured: 7, unidentified: 2, unjudged: 3 },
            { timeout: 3, move: 2 }
        );
        expect(report).toEqual({
            gameId: "g1",
            proposals: 0,
            captured: 7,
            unidentified: 2,
            unjudged: 3,
            "judge.timeout": 3,
            "judge.move": 2,
        });
    });

    it("carries the server judge's measurements as p50 / max, the failed calls by kind (issue #9528)", () => {
        const report = proposalCountsReport(
            "g1",
            { proposals: [], captured: 5, unidentified: 0, unjudged: 2 },
            { move: 3, "server-rejected": 1, "server-error": 1 },
            {
                serverMs: [900, 300.4, 1200],
                roundTripMs: [1500.6, 450, 2600],
                heapMb: [180.5, 210.25],
                peakRssMb: [260, 301.5],
            }
        );
        expect(report).toEqual({
            gameId: "g1",
            proposals: 0,
            captured: 5,
            unidentified: 0,
            unjudged: 2,
            "judge.move": 3,
            "judge.server-rejected": 1,
            "judge.server-error": 1,
            "judge.serverMs.p50": 900,
            "judge.serverMs.max": 1200,
            "judge.roundTripMs.p50": 1501,
            "judge.roundTripMs.max": 2600,
            "judge.heapMb.max": 210.25,
            "judge.peakRssMb.max": 301.5,
        });
    });

    it("an even sample's p50 is its lower middle value (nearest rank)", () => {
        const report = proposalCountsReport(
            "g1",
            { proposals: [], captured: 2, unidentified: 0, unjudged: 0 },
            { move: 2 },
            {
                serverMs: [400, 100],
                roundTripMs: [700, 900],
                heapMb: [],
                peakRssMb: [],
            }
        );
        expect(report["judge.serverMs.p50"]).toBe(100);
        expect(report["judge.roundTripMs.p50"]).toBe(700);
    });

    it("omits every measurement with no sample — no answered consult is not a zero", () => {
        const report = proposalCountsReport(
            "g1",
            { proposals: [], captured: 3, unidentified: 0, unjudged: 3 },
            { "server-error": 3 },
            { serverMs: [], roundTripMs: [], heapMb: [], peakRssMb: [] }
        );
        expect(Object.keys(report).filter((k) => /Ms|Mb/.test(k))).toEqual([]);
    });

    it("an empty sample is a warning — the game that offers no review", () => {
        const { sink, logs } = recordingSink();
        reportProposalCounts(
            proposalCountsReport(
                "g1",
                { proposals: [], captured: 4, unidentified: 4, unjudged: 0 },
                {}
            ),
            sink
        );
        expect(logs).toHaveLength(1);
        expect(logs[0].level).toBe("warn");
        expect(logs[0].attributes.unidentified).toBe(4);
    });

    it("a sample with proposals is an info log", () => {
        const { sink, logs } = recordingSink();
        reportProposalCounts({ gameId: "g1", proposals: 2 }, sink);
        expect(logs.map((l) => l.level)).toEqual(["info"]);
    });

    it("no decision captured reaches the sink with the game id", () => {
        const { sink, logs } = recordingSink();
        reportNoDecisionCaptured("g2", sink);
        expect(logs).toEqual([
            {
                level: "warn",
                message: "verdict proposals: no decision captured",
                attributes: { gameId: "g2" },
            },
        ]);
    });

    it("a failed sample is captured as an exception", () => {
        const { sink, exceptions } = recordingSink();
        const cause = new Error("worker blew up");
        reportSampleFailed("g3", cause, sink);
        expect(exceptions).toEqual([{ cause, gameId: "g3" }]);
    });

    it("a throwing sink never reaches the game-end path", () => {
        expect(() => {
            reportNoDecisionCaptured("g4", throwingSink);
            reportProposalCounts({ gameId: "g4", proposals: 0 }, throwingSink);
            reportSampleFailed("g4", new Error("x"), throwingSink);
        }).not.toThrow();
    });
});
