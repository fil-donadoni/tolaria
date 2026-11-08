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

/** How each game-end consult ended, by outcome — what tells `unjudged` apart:
 *  a production Worker timing out reads differently from a search that
 *  threw. */
export type JudgeOutcomeTally = Partial<Record<BrainOutcome, number>>;

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

/** The attributes of a finished sample: its counts and the consult
 *  outcomes, `judge.<outcome>` per outcome seen. */
export function proposalCountsReport(
    gameId: string,
    list: Pick<
        VerdictProposalList,
        "proposals" | "captured" | "unidentified" | "unjudged"
    >,
    judged: JudgeOutcomeTally
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
