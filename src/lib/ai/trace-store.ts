// AI DecisionTrace store (client-only, off the authoritative path).
//
// The vs-AI driver (`useVsAiDriver`) and the Debug panel live in different
// component subtrees, so the trace is handed between them through this tiny
// external store instead of prop-drilling GameState-adjacent data. The driver
// pushes each trace; the Debug panel reads them via `useAiTraces` (a
// `useSyncExternalStore` hook). Never persisted.
//
// It used to keep ONLY the latest decision, by design ("ultima decisione,
// sempre visibile"). Issue #3404 made it a short ring, because the question a
// tester actually arrives with is about a play that has already happened: by
// the time they notice the blunder and open the box, the bot has taken two or
// three more decisions and overwritten it. A ring is what makes the box
// readable after the fact instead of only during.

import type { DecisionTrace, Move, Phase } from "@convex/gre";
import type { PublicGameState } from "@convex/gameProjections";
import type { ExpectedInputKind } from "@convex/gre/expectedInput";
import type { BrainOutcome } from "./brain-request";
import type { BrainResult } from "./brain-client";
import type { BotAction } from "./brain";
import type { DeckKnowledgeBySeat } from "./state-adapter";

/** One traced decision, as the Debug panel shows it. */
export type AiTraceRecord = {
    /** Stable identity for the render key, monotonic within the tab.
     *
     *  NOT `at`, and not `at` plus a list index: the panel renders the ring
     *  NEWEST FIRST, so every existing row's index shifts on each push. Keyed
     *  on the index, React would remount the whole list on every bot decision
     *  and snap shut any `<details>` the tester had opened — which is the one
     *  piece of uncontrolled DOM state this box now has, and the disclosure
     *  the slice exists to add. `Date.now()` alone is not enough either: two
     *  decisions can land in the same millisecond. */
    id: number;
    trace: DecisionTrace;
    /** Whether a Worker produced it. `"inline"` means the consult ran on the
     *  MAIN THREAD instead — the Worker was unavailable, had already failed its
     *  respawn budget (issue #3040), or `Worker` does not exist in this
     *  environment at all — which is a degraded path, not the normal one, and
     *  the box marks it. The union comes from `BrainResult` rather than being
     *  re-typed here, so the two cannot drift. */
    via: BrainResult["via"];
    at: number;
    /** The state version the search ran on, when the pusher supplied a
     *  position. Provenance for a Verdict given here (issue #3405): nothing
     *  rebuilds from it — the board is in the spec — but it is what lets a file
     *  in `data/verdicts/` be traced back to the moment in the match that
     *  produced it. */
    seq?: number;
    /** Set once a tester has judged this decision through the verdict quiz
     *  (issue #3405). Kept ON the record rather than in a second map because
     *  `useAiTraces` is a `useSyncExternalStore` over this array: a judgement
     *  filed anywhere else would not change the snapshot, so the box would go
     *  on offering "Judge this move" for a decision already judged until some
     *  unrelated push happened to re-render it. Session-scoped like the ring
     *  itself — the durable record is the row the mutation wrote. */
    judged?: {
        /** Who gave it, as the account's nickname. The box shows it to an
         *  admin; a tester only ever sees their own judgements, so the name
         *  says nothing they did not already know. */
        author?: string;
        at: number;
    };
};

let nextTraceId = 1;

/** Deliberately short. The ring exists so a decision survives the two or three
 *  that follow it while the tester reaches for the panel; it is not a log, and
 *  every entry holds a full candidate list with a per-term breakdown each. */
const TRACE_RING_LIMIT = 8;

let traces: AiTraceRecord[] = [];
const listeners = new Set<() => void>();

/** Everything the search's own position can be rebuilt FROM — the projection
 *  the consult was handed and the knowledge it was given (issue #3405).
 *
 *  Not the `GameState` itself, because the main thread never holds one: the
 *  consult reconstructs it inside the Worker (`projectedToGameState`, a pure
 *  function of exactly these three values). Keeping the inputs means the quiz
 *  can reproduce that state bit for bit when a tester asks for it, and costs
 *  nothing for the decisions nobody judges — which is almost all of them. */
export type AiTraceSource = {
    /** The wire projection the consult was called with. */
    state: PublicGameState;
    /** The seat the projection was made for, and whose decision it was. */
    botId: string;
    /** The per-seat deck knowledge the difficulty preset allowed (issue
     *  #2790/#2788). Part of the reconstruction, so a verdict is given on the
     *  board the Bot BELIEVED it was on, not on a better-informed one. */
    knowledge?: DeckKnowledgeBySeat;
};

/** The source of each traced decision, BESIDE the ring rather than inside its
 *  records: `AiTraceRecord` is COPIED WHOLE — the box's "Copy" button
 *  stringifies the ring into a bug report — and a projected board per entry
 *  would turn a readable paste into a megabyte of instance ids. Nothing
 *  serialises this map. */
const sources = new Map<number, AiTraceSource>();

/** Record one traced decision. A null trace is DROPPED rather than pushed: a
 *  consult that failed or legitimately found no move has nothing to explain,
 *  and clearing the ring on it would throw away the decisions the tester opened
 *  the panel for. The failure itself is not lost — it is what the decision log
 *  above (`recordAiDecision`) exists to record.
 *
 *  `source` is what the decision was taken ON — the projection handed to the
 *  consult, the seat, and the deck knowledge it was allowed. Optional, so a
 *  caller with nothing to offer still records the reasoning: a decision without
 *  one simply cannot be judged, which the quiz says out loud rather than
 *  guessing a board. */
export function pushAiTrace(
    trace: DecisionTrace | null,
    via: BrainResult["via"],
    source?: AiTraceSource
): void {
    if (!trace) return;
    const id = nextTraceId++;
    traces = [
        ...traces,
        {
            id,
            trace,
            via,
            at: Date.now(),
            ...(source === undefined ? {} : { seq: source.state.seq }),
        },
    ].slice(-TRACE_RING_LIMIT);
    if (source) sources.set(id, source);
    // Evicted with the ring, or the map is a leak that grows with the game.
    const live = new Set(traces.map((t) => t.id));
    for (const key of sources.keys()) {
        if (!live.has(key)) sources.delete(key);
    }
    for (const l of listeners) l();
}

/** Oldest first — the panel reverses for display. */
export function getAiTraces(): AiTraceRecord[] {
    return traces;
}

/** What a traced decision was taken on, or `undefined` when the pusher had
 *  nothing to offer (or the entry has since fallen out of the ring). */
export function getAiTraceSource(id: number): AiTraceSource | undefined {
    return sources.get(id);
}

/** Mark a decision judged (issue #3405) — the quiz's own receipt, so the box
 *  stops offering to judge what a tester has already answered. A record that
 *  has fallen out of the ring is a no-op rather than an error: the mutation
 *  already succeeded, and the durable record is the row it wrote. */
export function markAiTraceJudged(id: number, author?: string): void {
    const index = traces.findIndex((t) => t.id === id);
    if (index === -1) return;
    const next = [...traces];
    next[index] = {
        ...next[index],
        judged: { ...(author === undefined ? {} : { author }), at: Date.now() },
    };
    traces = next;
    for (const l of listeners) l();
}

export function clearAiTraces(): void {
    if (traces.length === 0) return;
    traces = [];
    sources.clear();
    for (const l of listeners) l();
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

/** Why a decision ended the way it did. The Brain's own outcomes, plus the ones
 *  the DRIVER owns: the fast path that never consulted, a non-search
 *  realisation, a decision that realised into nothing, a window with no answer,
 *  and a submission the server rejected. */
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
    /** The Expected Input kind the game was resting on (ADR 0047).
     *
     *  Optional since issue #3040, for the ONE writer that has no window: a
     *  Brain Worker whose script fails at WARM-UP time (`warmBrain`, called on
     *  mount) fails before the game rests on the bot at all, and that failure
     *  is the loudest evidence there is that the bot is about to pass every
     *  decision — it must reach a bug report, not vanish for want of a field it
     *  cannot honestly fill. Every DRIVER call site still goes through `note`,
     *  which requires all three. Absent, never faked: a plausible-looking
     *  default here reads as evidence, and a `seq` naming a version the failure
     *  never saw cannot be lined up with the board snapshot beside it, which is
     *  the whole job of these fields. */
    expectedKind?: ExpectedInputKind;
    /** Phase and state version, so a record can be lined up against the board
     *  snapshot a bug report captures alongside it. The ENGINE's `Phase`, for
     *  the same reason `expectedKind` above is the engine's union: a loose
     *  `string` lets a typo render as a plausible-looking blank. Both absent
     *  for a windowless record — see `expectedKind`. */
    phase?: Phase;
    seq?: number;
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
