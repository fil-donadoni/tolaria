// Latest AI DecisionTrace store (client-only, off the authoritative path).
//
// The vs-AI driver (`useVsAiDriver`) and the Debug panel live in different
// component subtrees, so the trace is handed between them through this tiny
// external store instead of prop-drilling GameState-adjacent data. The driver
// pushes the most recent trace; the Debug panel reads it via `useLatestAiTrace`
// (a `useSyncExternalStore` hook). Only the latest decision is kept — by design
// (see the grill: "ultima decisione, sempre visibile"). Never persisted.

import type { DecisionTrace, Move, Phase } from "@convex/gre";
import type { ExpectedInputKind } from "@convex/gre/expectedInput";
import type { BrainOutcome } from "./brain-request";
import type { BotAction } from "./brain";

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

// ────────────────────────────────────────────────────────────────────────────
// Decision breadcrumbs (issue #2470)
// ────────────────────────────────────────────────────────────────────────────
//
// The escalation ring above records the LADDER — what fired once the normal
// path had already produced nothing. It cannot say WHY the normal path produced
// nothing, and that distinction is the whole diagnosis: a search that threw, a
// Worker that died, a consult that timed out and a bot that simply chose to
// pass all reach the driver as the same "no move" (issue #2450, unrootcausable
// from its report for exactly this reason).
//
// So every decision the driver takes leaves one record here, INCLUDING the
// ordinary ones — a ring of passes with `outcome: "move"` is evidence too, it
// says the Brain was healthy and the bot meant it. Bounded, client-only, never
// authoritative (ADR 0074); it reaches a maintainer only when the reporter
// files a bug report, which attaches it.

/** Why a decision ended the way it did. The Brain's own outcomes plus the two
 *  the DRIVER owns: the fast path that never consulted, and a submission the
 *  server rejected. */
export type AiDecisionOutcome =
    | BrainOutcome
    /** `shouldThink` said the window was trivial: passed without consulting. */
    | "skip-pass"
    /** A non-search realisation (a parked payment, a mulligan declaration, a
     *  decline): answered directly, without consulting the Brain at all. This
     *  is the MAJORITY of `BotAction` kinds — `botActionRealisation` routes
     *  only five to the Worker. */
    | "direct"
    /** The bot decided on an action and `realiseBotAction` produced no runner
     *  for it: nothing was submitted. A defect — the window is left to the
     *  watchdog, and without this record it is the very "died leaving no
     *  trace" shape this ring exists to remove. */
    | "unrealisable"
    /** The engine named the bot as owing input and the Brain had no answer for
     *  that window (ADR 0047's `unanswered`). Escalated immediately. */
    | "unanswered"
    /** The chosen answer was submitted and the mutation rejected it. */
    | "submit-error";

/** One decision, as the Debug panel and a bug report show it. */
export type AiDecisionRecord = {
    outcome: AiDecisionOutcome;
    /** Whether a Worker was involved. Absent for driver-owned outcomes. */
    via?: "worker" | "inline";
    /** The Expected Input kind the game was resting on (ADR 0047). */
    expectedKind: ExpectedInputKind;
    /** Phase and state version, so a record can be lined up against the board
     *  snapshot a bug report captures alongside it. The ENGINE's `Phase`, for
     *  the same reason `expectedKind` above is the engine's union: a loose
     *  `string` lets a typo render as a plausible-looking blank. */
    phase: Phase;
    seq: number;
    /** The `Move` kind the SEARCH chose, when it chose one. */
    moveKind?: Move["kind"];
    /** The `BotAction` kind a non-search exit submitted. Distinct from
     *  `moveKind` on purpose — the two unions overlap in places (`pass`) and
     *  diverge in most, so collapsing them into one `string` would hide which
     *  layer answered. */
    actionKind?: BotAction["kind"];
    /** Failure text for the error outcomes, clamped — see `MAX_MESSAGE_CHARS`. */
    message?: string;
    at: number;
};

/** A rejected Convex mutation's client-side message routinely carries the
 *  server's error text and a stack. 60 of those, unclamped, can approach the
 *  1 MB document limit — at which point the insert throws and the reporter
 *  LOSES THE WHOLE REPORT, which is the opposite of what this field is for. */
const MAX_MESSAGE_CHARS = 500;

/** Long enough to cover several turns of decisions — the shape of the failure
 *  is a RUN of identical outcomes, and one record cannot show a run. Bounded
 *  because a long game must not grow it without limit, and because the whole
 *  ring travels inside a bug report. */
const DECISION_LOG_LIMIT = 60;

let decisions: AiDecisionRecord[] = [];
const decisionListeners = new Set<() => void>();

export function recordAiDecision(record: Omit<AiDecisionRecord, "at">): void {
    const message =
        record.message && record.message.length > MAX_MESSAGE_CHARS
            ? `${record.message.slice(0, MAX_MESSAGE_CHARS)}…`
            : record.message;
    decisions = [
        ...decisions,
        { ...record, ...(message ? { message } : {}), at: Date.now() },
    ].slice(-DECISION_LOG_LIMIT);
    for (const l of decisionListeners) l();
}

export function getAiDecisions(): AiDecisionRecord[] {
    return decisions;
}

export function clearAiDecisions(): void {
    if (decisions.length === 0) return;
    decisions = [];
    for (const l of decisionListeners) l();
}

export function subscribeAiDecisions(listener: () => void): () => void {
    decisionListeners.add(listener);
    return () => decisionListeners.delete(listener);
}
