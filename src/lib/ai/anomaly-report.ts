// "Report anomaly" — the decision a tester is reporting, from the box to the
// bug-report dialog (issue #3405, PRD #3397).
//
// The dialog is mounted ONCE at the router root (`BugReportButton`) and owns
// its own open flag; the decision box lives inside the debug sheet, in a
// different subtree entirely. There is no context between them and no reason to
// invent one for a single hand-off, so this is the same idiom the traces
// themselves already travel by: a tiny external store the reporter's side
// writes and the dialog's side reads.
//
// Two things travel, and they are deliberately separate:
//
//  - the REQUEST (a report is open on a decision), which the dialog's owner
//    watches for the moment it turns on, and which lasts until the dialog
//    closes;
//  - the DECISION ITSELF, which the diagnostics collector reads at SUBMIT time
//    (`collectAiDiagnostics`), because that is when the payload is assembled
//    and consented to.
//
// What travels is a PROJECTION, never the trace record: an allowlist, the same
// rule `client-diagnostics.ts` states for everything else that leaves a
// reporter's machine. The board is not in it — a bug report already carries the
// game id, and the `GameState` the quiz lowers is a debugging artifact of a
// different size entirely.

import type { AiTraceRecord } from "./trace-store";
import type { DecisionTrace } from "@convex/gre";

/** One candidate, reduced to what a reader of the issue can act on. */
export type ReportedCandidate = {
    label: string;
    visits: number;
    meanReward: number;
    meanMargin: number;
    /** The move the Bot actually played. */
    chosen: boolean;
};

/** The decision attached to an anomaly report. */
export type ReportedDecision = {
    /** The move the Bot played, as the box words it. */
    chosen: string;
    /** Which root rule settled the pick (`RootDecisionMechanism`) — the first
     *  question anyone triaging "the bot did something stupid" has to answer. */
    mechanism: DecisionTrace["mechanism"];
    /** Whether the Brain worker produced it, or the degraded inline path did. */
    via: AiTraceRecord["via"];
    /** Every candidate the search weighed, most-visited first. */
    candidates: ReportedCandidate[];
    /** When the decision was taken (epoch ms), so it lines up with the console
     *  ring and the decision log beside it in the same payload. */
    at: number;
};

/** The store's snapshot. Identity is stable between changes — it is read
 *  through `useSyncExternalStore`, which re-renders forever on a fresh object. */
export type AnomalyReportState = {
    /** Set while a request is outstanding: the dialog should be open. */
    requested: boolean;
    decision?: ReportedDecision;
};

const IDLE: AnomalyReportState = { requested: false };

let state: AnomalyReportState = IDLE;
const listeners = new Set<() => void>();

function emit(next: AnomalyReportState): void {
    state = next;
    for (const l of listeners) l();
}

/** Project a traced decision down to what a report may carry. */
export function reportedDecisionOf(record: AiTraceRecord): ReportedDecision {
    const { trace } = record;
    return {
        chosen: trace.chosen,
        mechanism: trace.mechanism,
        via: record.via,
        candidates: trace.candidates.map((candidate) => ({
            label: candidate.label,
            visits: candidate.visits,
            meanReward: candidate.meanReward,
            meanMargin: candidate.meanMargin,
            chosen: candidate.label === trace.chosen,
        })),
        at: record.at,
    };
}

/** Ask for the bug-report dialog, carrying this decision. */
export function requestAnomalyReport(record: AiTraceRecord): void {
    emit({ requested: true, decision: reportedDecisionOf(record) });
}

/** Forget the request and the decision — the dialog closed, and the next report
 *  is not about it. This is the ONLY way the flag goes down: a request the
 *  opener acknowledged separately would leave the two halves free to disagree
 *  about whether a report is in progress. */
export function clearAnomalyReport(): void {
    if (state === IDLE) return;
    emit(IDLE);
}

export function getAnomalyReportState(): AnomalyReportState {
    return state;
}

/** What the diagnostics collector attaches, or `undefined` when the reporter
 *  did not come from a decision. */
export function getReportedDecision(): ReportedDecision | undefined {
    return state.decision;
}

export function subscribeAnomalyReport(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
