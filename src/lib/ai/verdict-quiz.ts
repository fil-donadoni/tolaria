// The verdict quiz's model: one Bot decision, lowered into the thing a Verdict
// is made of (issue #3405, PRD #3397, ADR 0124 §1).
//
// The lowering itself is NOT here. It is `convex/gre/ai/verdicts/lowering.ts`,
// because the browser stopped being its only caller: the lowering sweep
// (issue #3461) runs the same function at every decision of a headless
// self-play game to measure which refusals actually fire. What stays here is
// the browser's half — turning the Brain's `AiTraceSource` into the raw
// position the sweep already has, and flattening the refusal's frozen KIND
// back into the single error string this panel renders today.

import { projectedToGameState } from "./state-adapter";
import {
    lowerDecision,
    QUIZ_SEAT,
    type VerdictRefusalKind,
} from "@convex/gre/ai/verdicts/lowering";
import type { VerdictCandidate } from "@convex/gre/ai/verdicts/types";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { DecisionTrace } from "@convex/gre";
import type { AiTraceSource } from "./trace-store";

export { QUIZ_SEAT };
export type { VerdictRefusalKind };

/** What the quiz renders and submits. */
export type VerdictQuiz = {
    /** The position, lowered from the board the search ran on. */
    spec: ScenarioSpec;
    /** The candidates as the REBUILT position offers them, in enumeration
     *  order — the list the fit will re-derive, so an index here means the same
     *  move there. */
    candidates: VerdictCandidate[];
    /** Which of them the Bot played. Always known: a rebuild that does not
     *  offer the Bot's own move is refused below, not shown. */
    botPickIndex: number;
    /** Everything the lowering could not carry (`specFromState`'s own report):
     *  the stack, a mana pool, combat past the declare step, … A verdict given
     *  on a position missing one of those is a judgement about a DIFFERENT
     *  board, so the quiz shows this rather than burying it. */
    dropped: string[];
};

export type VerdictQuizResult =
    | { ok: true; quiz: VerdictQuiz }
    | { ok: false; error: string; kind: VerdictRefusalKind };

/**
 * Lower one traced decision into a quiz, or say why it cannot be one.
 *
 * `source` is what the consult was called with; the position is reconstructed
 * from it by the same `projectedToGameState` the Brain uses, so the board
 * judged here is the board the search ran on — including what the Bot was not
 * allowed to know.
 */
export function buildVerdictQuiz(
    trace: DecisionTrace,
    source: AiTraceSource
): VerdictQuizResult {
    const position = projectedToGameState(
        source.state,
        source.knowledge,
        source.botId
    );
    const outcome = lowerDecision(position, source.botId, trace.chosen);
    return outcome.ok
        ? { ok: true, quiz: outcome.lowered }
        : { ok: false, error: outcome.error, kind: outcome.kind };
}
