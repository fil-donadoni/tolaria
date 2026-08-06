// Latest AI DecisionTrace store (client-only, off the authoritative path).
//
// The vs-AI driver (`useVsAiDriver`) and the Debug panel live in different
// component subtrees, so the trace is handed between them through this tiny
// external store instead of prop-drilling GameState-adjacent data. The driver
// pushes the most recent trace; the Debug panel reads it via `useLatestAiTrace`
// (a `useSyncExternalStore` hook). Only the latest decision is kept — by design
// (see the grill: "ultima decisione, sempre visibile"). Never persisted.

import type { DecisionTrace } from "@convex/gre";
import type { ExpectedInputKind } from "@convex/gre/expectedInput";

let latest: DecisionTrace | null = null;
const listeners = new Set<() => void>();

export function setLatestAiTrace(trace: DecisionTrace | null): void {
    latest = trace;
    for (const l of listeners) l();
}

export function getLatestAiTrace(): DecisionTrace | null {
    return latest;
}

export function subscribeAiTrace(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// ────────────────────────────────────────────────────────────────────────────
// Liveness escalations (issue #2284)
// ────────────────────────────────────────────────────────────────────────────
//
// A decision the bot could not make is not a decision, so it has no
// `DecisionTrace` to ride on — yet it is exactly the thing that must not be
// silent. Escalations therefore get their own ring in this same store, read by
// the same Debug panel: "the game was waiting on the bot for a <kind> input and
// the normal path produced nothing, so rung N fired". Failure is loud.

/** One escalation, as the Debug panel shows it. */
export type AiEscalationRecord = {
    /** The ladder rung that fired. 1 = re-run the normal decision path;
     *  2 = the minimal-legal answer; 3 = the CR decline; 4 = a priority pass;
     *  5 = the last rung, a user-visible actionable state. */
    rung: number;
    /** The Expected Input kind the game was resting on (ADR 0047) — the whole
     *  point of the record: it names the window nobody wired. The ENGINE's union,
     *  not a loose `string`: `BotStuckNotice` keys its player-facing
     *  `WINDOW_LABEL` by it, so a stale or typo'd kind must be a build error
     *  rather than a rendered blank. */
    expectedKind: ExpectedInputKind;
    /** The `BotAction.kind` the rung submitted, or a short reason when the rung
     *  submitted nothing. */
    action: string;
    at: number;
};

/** Keep the recent history rather than only the latest: an escalation is rare
 *  and the SEQUENCE (rung 1 → 2 → 3) is what makes it diagnosable. */
const ESCALATION_LOG_LIMIT = 20;

let escalations: AiEscalationRecord[] = [];
const escalationListeners = new Set<() => void>();

export function recordAiEscalation(
    record: Omit<AiEscalationRecord, "at">
): void {
    escalations = [...escalations, { ...record, at: Date.now() }].slice(
        -ESCALATION_LOG_LIMIT
    );
    for (const l of escalationListeners) l();
}

export function getAiEscalations(): AiEscalationRecord[] {
    return escalations;
}

export function clearAiEscalations(): void {
    if (escalations.length === 0) return;
    escalations = [];
    for (const l of escalationListeners) l();
}

export function subscribeAiEscalations(listener: () => void): () => void {
    escalationListeners.add(listener);
    return () => escalationListeners.delete(listener);
}
