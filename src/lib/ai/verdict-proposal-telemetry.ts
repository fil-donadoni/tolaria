// Where a finished vs-Bot game's Verdict Proposal sample ended up, reported
// somewhere a maintainer can READ it (issue #8732).
//
// The post-game review (`Review your decisions`) appears only when the sample
// yields at least one proposal. When it does not, the reason is one of three
// lines — no decision captured, the counts of a sample that came back empty,
// or a sample that threw — and until this module they went to the browser
// console only. The SDK in `main.tsx` does not forward console output as logs
// (no console integration), so in production those lines reached nobody but a
// tester with devtools open, and issue #8732 could not name its cause.
//
// Each report now goes to the console AND to Sentry: the counts and the empty
// capture as structured logs (`enableLogs` is on), a failed sample as a
// captured exception. Attributes carry only the game id and counts — no
// player, no card, no state (`userInfo: false` stays the contract). Sentry is
// best-effort: a throw from the SDK never reaches the game-end path.

import * as Sentry from "@sentry/react";
import type { BrainOutcome } from "./brain-request";
import type { VerdictProposalList } from "./verdict-proposals";

/** How one game-end consult ended: the server search's own outcome, or the
 *  call failing — `server-rejected` when the server's guard refused it
 *  (`ConvexError`), `server-error` for any other failure of the call. */
export type JudgeOutcome = BrainOutcome | "server-rejected" | "server-error";

/** How each game-end consult ended, by outcome — what tells `unjudged` apart:
 *  a call the server refused reads differently from a search that threw. */
export type JudgeOutcomeTally = Partial<Record<JudgeOutcome, number>>;

/** The server judge's measurements, one entry per ANSWERED consult: the
 *  server's own search time, the client's round trip of the same call (their
 *  difference is cold start + module load + network), and the server
 *  process's memory where it could be read. */
export type JudgeTimings = {
    serverMs: number[];
    roundTripMs: number[];
    heapMb: number[];
    peakRssMb: number[];
};

/** The structured attributes of one report — flat primitives, the shape
 *  Sentry log attributes accept. */
export type VerdictProposalReport = Record<string, string | number>;

/** Where a report goes besides the console. The default is Sentry; a test
 *  hands its own, so the routing is observed without a module mock. */
export type TelemetrySink = {
    log: (
        level: "info" | "warn",
        message: string,
        attributes: VerdictProposalReport
    ) => void;
    exception: (cause: unknown, gameId: string) => void;
};

export const sentrySink: TelemetrySink = {
    log: (level, message, attributes) =>
        Sentry.logger[level](message, attributes),
    exception: (cause, gameId) => {
        Sentry.captureException(cause, {
            tags: { feature: "verdict-proposals" },
            extra: { gameId },
        });
    },
};

function bestEffort(send: () => void): void {
    try {
        send();
    } catch {
        // Monitoring never costs the game-end path its proposals.
    }
}

/** The nearest-rank median of a non-empty sample. */
function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length / 2) - 1];
}

/** `<key>.p50` and `<key>.max` of a sample, rounded to `digits` decimals —
 *  nothing at all for an empty one: no sample is not a zero. */
function summarise(
    report: VerdictProposalReport,
    key: string,
    values: readonly number[],
    digits: number
): void {
    if (values.length === 0) return;
    const scale = 10 ** digits;
    const round = (n: number) => Math.round(n * scale) / scale;
    report[`${key}.p50`] = round(median(values));
    report[`${key}.max`] = round(Math.max(...values));
}

/** The attributes of a finished sample: its counts, the consult outcomes
 *  (`judge.<outcome>` per outcome seen) and the server judge's measurements
 *  (p50 / max over the game's answered consults; memory as max only). */
export function proposalCountsReport(
    gameId: string,
    list: Pick<
        VerdictProposalList,
        "proposals" | "captured" | "unidentified" | "unjudged"
    >,
    judged: JudgeOutcomeTally,
    timings?: JudgeTimings
): VerdictProposalReport {
    const report: VerdictProposalReport = {
        gameId,
        proposals: list.proposals.length,
        captured: list.captured,
        unidentified: list.unidentified,
        unjudged: list.unjudged,
    };
    for (const [outcome, count] of Object.entries(judged)) {
        if (count) report[`judge.${outcome}`] = count;
    }
    if (timings) {
        summarise(report, "judge.serverMs", timings.serverMs, 0);
        summarise(report, "judge.roundTripMs", timings.roundTripMs, 0);
        if (timings.heapMb.length > 0) {
            report["judge.heapMb.max"] = Math.max(...timings.heapMb);
        }
        if (timings.peakRssMb.length > 0) {
            report["judge.peakRssMb.max"] = Math.max(...timings.peakRssMb);
        }
    }
    return report;
}

/** The game ended with no decision of the human seat kept. */
export function reportNoDecisionCaptured(
    gameId: string,
    sink: TelemetrySink = sentrySink
): void {
    const report: VerdictProposalReport = { gameId };
    console.info("verdict proposals: no decision captured", report);
    bestEffort(() =>
        sink.log("warn", "verdict proposals: no decision captured", report)
    );
}

/** The sample finished: what it kept, and what fell out on the way. An empty
 *  list is a warning — it is the game that offers no review. */
export function reportProposalCounts(
    report: VerdictProposalReport,
    sink: TelemetrySink = sentrySink
): void {
    console.info("verdict proposals", report);
    bestEffort(() => {
        if (report.proposals === 0) {
            sink.log("warn", "verdict proposals: none", report);
        } else {
            sink.log("info", "verdict proposals", report);
        }
    });
}

/** The sample threw: no list, so no review for this game. */
export function reportSampleFailed(
    gameId: string,
    cause: unknown,
    sink: TelemetrySink = sentrySink
): void {
    console.error("verdict proposals: sample failed", cause);
    bestEffort(() => sink.exception(cause, gameId));
}
