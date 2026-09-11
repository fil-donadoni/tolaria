// The AI diagnostics a bug report carries (issue #2470).
//
// The play bot is client-hosted (ADR 0074): its search, its failures and its
// escalations all happen in the reporter's own tab and are visible to no one
// else. A report filed while the bot misbehaves therefore reaches the tracker
// with a perfect board snapshot and NOTHING about the decision that produced
// it — which is exactly why #2450 ("BOT doesn't play any land") could not be
// root-caused: replaying its captured state chose the land correctly at every
// layer, so whatever failed left no trace.
//
// This is the one place that decides what travels. Read at SUBMIT time (the
// rings are live, and a value captured at dialog mount would be stale), plain
// JSON only, and empty means absent — a report from the lobby or from a
// human-vs-human game must not carry empty scaffolding that reads as evidence.

import {
    getAiDecisions,
    getAiEscalations,
    type AiDecisionRecord,
    type AiEscalationRecord,
} from "./trace-store";
import { getReportedDecision, type ReportedDecision } from "./anomaly-report";

export type AiDiagnostics = {
    /** Every decision exit the driver took, oldest first. The diagnosis is the
     *  RUN — a wall of `worker-error` says the Brain never answered; a wall of
     *  `move` says it answered and the bot meant what it did. */
    decisions: AiDecisionRecord[];
    /** The liveness ladder's rungs (issue #2284), for the same window. */
    escalations: AiEscalationRecord[];
    /** THE decision the report is about, when the reporter opened the dialog
     *  from one (issue #3405): its candidates, the Bot's pick and the rule that
     *  settled it. The decision log above says which exits the driver took and
     *  nothing about what the Bot weighed — which is exactly the question an
     *  anomaly report asks, and the reason "the bot did something stupid" has
     *  historically arrived with no way to tell a bad evaluation from a search
     *  that never ran. */
    reportedDecision?: ReportedDecision;
};

/** The rings as they stand right now, or `undefined` when there is nothing to
 *  say. Pure read — collecting diagnostics never clears them, so the Debug
 *  panel still shows what the report took. */
export function collectAiDiagnostics(): AiDiagnostics | undefined {
    const decisions = getAiDecisions();
    const escalations = getAiEscalations();
    const reportedDecision = getReportedDecision();
    if (
        decisions.length === 0 &&
        escalations.length === 0 &&
        !reportedDecision
    ) {
        return undefined;
    }
    return {
        decisions,
        escalations,
        ...(reportedDecision ? { reportedDecision } : {}),
    };
}
