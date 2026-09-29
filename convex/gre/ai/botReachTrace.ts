/**
 * The decision behind a Bot Findings refusal (issue #4179, PRD #4174).
 *
 * When the sweep reports a card `never-chosen`, the search that refused it
 * already knew what it preferred instead: the move it chose, the card's own
 * move, the alternatives it weighed and the evaluation terms behind each. That
 * is the `DecisionTrace` `searchWithTrace` builds anyway (it is built AFTER the
 * move is chosen and never perturbs selection), and this module keeps a
 * BOUNDED projection of it on the verdict — so the finding says WHY, not only
 * THAT, and a session picking the finding up starts from evidence.
 *
 * Bounded three ways, so the committed artifact cannot grow with the search:
 *
 *  - at most {@link BOT_REACH_TRACE_MAX_CANDIDATES} candidates — the chosen
 *    move, the card's own most-visited move, then the most-visited remaining
 *    alternatives. No search tree, no determinizations;
 *  - labels cut at {@link BOT_REACH_TRACE_LABEL_MAX} characters;
 *  - the evaluation terms as `EvalTerms` defines them, rounded to two decimals,
 *    and only the terms that are non-zero for either side.
 *
 * Inside the Bot hash on purpose (it lives in `convex/gre/ai/`): the trace is
 * cached with the verdict, so a change to the projection must replay the
 * sweep rather than leave traces written by an older projection standing.
 *
 * Pure: a function of the `DecisionTrace` and the card instance id.
 */

import type { EvalTerms } from "../evaluate";
import type { CandidateTrace, DecisionTrace } from "../search";
import type { RootDecisionMechanism } from "./decisionTelemetry";

/** The chosen move, the card's own move and at most three alternatives. */
export const BOT_REACH_TRACE_MAX_CANDIDATES = 5;

/** A move label longer than this is cut — `describeMove` labels are short,
 *  but a label is card text, and card text is not bounded. */
export const BOT_REACH_TRACE_LABEL_MAX = 80;

/** Why a candidate is on the trace. */
export type BotReachTraceRole = "chosen" | "card" | "alternative";

/** One evaluation term's contribution for the Bot (`self`) and its opponent
 *  (`opp`), as `[self, opp]`. Mutable array types throughout this file: the
 *  shape is restated as a Convex validator (`convex/botFindingsCore.ts`),
 *  whose inferred type has mutable arrays, and a `readonly` array would not
 *  be assignable to it. */
export type BotReachTraceTerms = Partial<
    Record<keyof EvalTerms, [number, number]>
>;

export interface BotReachTraceCandidate {
    readonly role: BotReachTraceRole;
    readonly label: string;
    /** Root visits — the search's selection criterion. */
    readonly visits: number;
    /** Mean reward in [0, 1], the Bot's perspective. */
    readonly meanReward: number;
    /** The full evaluation of the position the move leads to
     *  (`PositionBreakdown.total`). */
    readonly total: number;
    /** Non-zero terms only; absent when the probe could not apply the move
     *  (`CandidateTrace.unavailable`) — an uninformative breakdown is not
     *  evidence, so it is not recorded as if it were. */
    readonly terms?: BotReachTraceTerms;
}

/**
 * What happened to the card's own move at the refusing decision — the first
 * half of the answer, and often the whole of it:
 *
 *  - `pruned`     — dominance proved it a no-op before the search ran
 *                   (`pruneDominatedNoOps`, issue #1887): it was never weighed;
 *  - `collapsed`  — folded into an interchangeable twin (issue #3593);
 *  - `unexpanded` — offered to the search, never expanded inside the budget;
 *  - `weighed`    — the search weighed it and preferred something else.
 */
export type BotReachCardMove =
    | "pruned"
    | "collapsed"
    | "unexpanded"
    | "weighed";

/** The search's side of the decision. */
export interface BotReachSearch {
    /** Which root rule settled the pick (`DecisionTrace.mechanism`). */
    readonly mechanism: RootDecisionMechanism;
    /** Iterations the search ran — the sweep's fixed budget, never time. */
    readonly iterations: number;
    /** How many root moves the search weighed in all; the candidates below
     *  are a bounded subset of them. */
    readonly weighed: number;
    /** Chosen first, then the card's move, then alternatives by visits. */
    readonly candidates: BotReachTraceCandidate[];
}

export interface BotReachTrace {
    readonly cardMove: BotReachCardMove;
    /** Absent when no search ran: pruning left a single forced move, so the
     *  engine had nothing to weigh (`searchWithTrace` returns no trace). */
    readonly search?: BotReachSearch;
}

function round2(value: number): number {
    const r = Math.round(value * 100) / 100;
    // `-0` serializes as `0` but compares unequal under Object.is; normalize
    // so a replay is byte- AND value-identical.
    return r === 0 ? 0 : r;
}

function clip(label: string): string {
    return label.length <= BOT_REACH_TRACE_LABEL_MAX
        ? label
        : `${label.slice(0, BOT_REACH_TRACE_LABEL_MAX - 1)}…`;
}

function termsOf(c: CandidateTrace): BotReachTraceTerms | undefined {
    if (c.unavailable) return undefined;
    const terms: BotReachTraceTerms = {};
    for (const key of Object.keys(c.eval.self) as (keyof EvalTerms)[]) {
        const self = round2(c.eval.self[key]);
        const opp = round2(c.eval.opp[key]);
        if (self !== 0 || opp !== 0) terms[key] = [self, opp];
    }
    return terms;
}

function project(
    c: CandidateTrace,
    role: BotReachTraceRole
): BotReachTraceCandidate {
    const terms = termsOf(c);
    return {
        role,
        label: clip(c.label),
        visits: c.visits,
        meanReward: round2(c.meanReward),
        total: round2(c.eval.total),
        ...(terms === undefined ? {} : { terms }),
    };
}

/** Does the root candidate use the card instance? */
function usesInstance(c: CandidateTrace, instanceId: string): boolean {
    return "cardInstanceId" in c.move && c.move.cardInstanceId === instanceId;
}

/**
 * The bounded projection of a decision that refused the card `instanceId`.
 * `trace` is `searchWithTrace`'s (null when no search ran); `fate` is what
 * root enumeration did to the card's move before the search, when it dropped
 * it. `trace.candidates` is most-visited first; the chosen move is the one
 * whose label matches `trace.chosen` (the first such, so a label shared by two
 * root moves resolves deterministically), falling back to the most-visited.
 */
export function projectBotReachTrace(
    trace: DecisionTrace | null,
    instanceId: string,
    fate?: "pruned" | "collapsed"
): BotReachTrace {
    if (trace === null) return { cardMove: fate ?? "unexpanded" };
    const all = trace.candidates;
    const chosen = all.find((c) => c.label === trace.chosen) ?? all[0];
    const card = all.find((c) => c !== chosen && usesInstance(c, instanceId));
    const picked: BotReachTraceCandidate[] = [];
    if (chosen !== undefined) picked.push(project(chosen, "chosen"));
    if (card !== undefined) picked.push(project(card, "card"));
    for (const c of all) {
        if (picked.length >= BOT_REACH_TRACE_MAX_CANDIDATES) break;
        if (c === chosen || c === card) continue;
        picked.push(project(c, "alternative"));
    }
    return {
        cardMove: fate ?? (card !== undefined ? "weighed" : "unexpanded"),
        search: {
            mechanism: trace.mechanism,
            iterations: trace.iterationsCompleted,
            weighed: all.length,
            candidates: picked,
        },
    };
}
