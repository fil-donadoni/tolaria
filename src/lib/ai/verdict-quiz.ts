// The verdict quiz's model: one Bot decision, lowered into the thing a Verdict
// is made of (issue #3405, PRD #3397, ADR 0124 §1).
//
// The lowering itself is NOT here. It is `convex/gre/ai/verdicts/lowering.ts`,
// because the browser stopped being its only caller: the lowering sweep
// (issue #3461) runs the same function at every decision of a headless
// self-play game to measure which refusals actually fire. What stays here is
// the browser's half — turning the Brain's `AiTraceSource` into the raw
// position the sweep already has, and giving a refusal the shape a PANEL needs
// (issue #3457): the frozen KIND turned into a one-line TITLE, the prose kept
// beside it as the detail, the dropped notes kept as a LIST rather than folded
// into the middle of a sentence, and a plain-text report a tester can paste.

import { projectedToGameState } from "./state-adapter";
import {
    lowerDecision,
    QUIZ_SEAT,
    VERDICT_REFUSAL_KINDS,
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
     *  the stack, a mid-flight payment, an instance-keyed restricted-mana
     *  permission (CR 106.6), … A verdict given
     *  on a position missing one of those is a judgement about a DIFFERENT
     *  board, so the quiz shows this rather than burying it. */
    dropped: string[];
};

/**
 * Why the quiz could not be built — the PANEL's vocabulary, which is the
 * lowering's plus the two refusals only a browser can have.
 *
 * The lowering's kinds are inherited, never restated: `VERDICT_REFUSAL_KINDS`
 * is the frozen union `lowerDecision` refuses with and the lowering sweep
 * ranks, and a second copy here is how the two would drift. What is added is
 * the pair of sites ABOVE the lowering — a decision whose position the trace
 * store no longer holds, and a builder chunk that failed to load or threw —
 * which the panel refuses with today in free prose with no kind at all.
 *
 * They are deliberately NOT added to `VERDICT_REFUSAL_KINDS`: the sweep seeds
 * a counter per member and runs headless, where neither site can ever fire, so
 * a browser-only kind there would report a permanent zero as a measurement.
 */
export const QUIZ_ONLY_REFUSAL_KINDS = [
    "position-not-held",
    "builder-threw",
] as const;

export const QUIZ_REFUSAL_KINDS = [
    ...VERDICT_REFUSAL_KINDS,
    ...QUIZ_ONLY_REFUSAL_KINDS,
] as const;

export type QuizRefusalKind = (typeof QUIZ_REFUSAL_KINDS)[number];

/** How one refusal kind presents itself. */
type RefusalPresentation = {
    /** ONE line, recognisable at a glance: three refusals in a row being the
     *  same class is the thing a tester needs to see without reading four
     *  lines of prose each (issue #3457). */
    title: string;
    /** The issue that would REMOVE this refusal, when the cause is one known
     *  spec gap, and `null` when it is not. Static by construction — never a
     *  lookup, and never a guess: `different-decision` and `pick-not-offered`
     *  are caused by whichever fact the lowering lost on THIS board, which is
     *  any of a dozen open gaps, so they name none and let `dropped[]` say it. */
    trackedBy: number | null;
};

/**
 * The ONE table the refusal panel renders from — title and tracking issue per
 * kind, in the order the sites run.
 *
 * `Record<QuizRefusalKind, …>` is the exhaustiveness: a ninth kind added to
 * the array above reds `tsc` here until it says what it is called, which is
 * the whole reason the kind is a frozen union rather than a string.
 */
export const QUIZ_REFUSALS: Record<QuizRefusalKind, RefusalPresentation> = {
    "stack-not-empty": {
        title: "Something was on the stack",
        trackedBy: 3456,
    },
    "lowering-threw": {
        title: "This position could not be lowered into a scenario",
        trackedBy: null,
    },
    "combat-not-captured": {
        title: "The combat could not be captured",
        // Not `null` like its neighbours: this one has a single, named cause —
        // a combat fact `ScenarioSpec` still cannot express — rather than
        // "whichever of a dozen gaps this board hit".
        trackedBy: 3458,
    },
    "rebuild-threw": {
        title: "The lowered scenario could not be rebuilt",
        trackedBy: null,
    },
    "no-decision-owed": {
        title: "The rebuilt position owes the Bot no decision",
        trackedBy: null,
    },
    "single-candidate": {
        title: "Only one legal move — a verdict would state no preference",
        trackedBy: null,
    },
    "different-decision": {
        title: "The rebuild offers a DIFFERENT decision",
        trackedBy: null,
    },
    "pick-not-offered": {
        title: "The rebuild does not offer the move the Bot played",
        trackedBy: null,
    },
    "position-not-held": {
        title: "This decision's position is no longer held",
        trackedBy: null,
    },
    "builder-threw": {
        // NOT "failed to load": the panel's `.catch` also swallows every
        // synchronous throw out of `buildVerdictQuiz` — `projectedToGameState`
        // and the live `candidateMoves` both run outside any try/catch — so a
        // real engine throw would read as a chunk-loading problem and send a
        // tester chasing the wrong thing (PR review, issue #3457).
        title: "The quiz could not be built",
        trackedBy: null,
    },
};

/**
 * A refusal, as the panel renders it and as Copy reports it.
 *
 * The TITLE is deliberately not on it. Carried as a `string` field it would be
 * hand-writable — a future refusal site could pass its own, or an empty one,
 * with nothing to red — and the "one table is the only authority" claim above
 * would be a convention rather than a type. Both readers look the title up
 * from {@link QUIZ_REFUSALS} by `kind` instead, which the `Record` already
 * guarantees exists for every kind (PR review, issue #3457).
 */
export type VerdictQuizRefusal = {
    kind: QuizRefusalKind;
    /** The sentence underneath the title: the lowering's own `error`, or the
     *  panel's for a browser-only kind. */
    detail: string;
    /** What the lowering could not carry, one note per line. Empty for the
     *  refusals that fire before `specFromState` ever runs. */
    dropped: string[];
};

/** Build the refusal record for one kind. */
export function quizRefusal(
    kind: QuizRefusalKind,
    detail: string,
    dropped: string[] = []
): VerdictQuizRefusal {
    return { kind, detail, dropped };
}

/**
 * The refusal as plain text, for the Copy button (issue #3457).
 *
 * Carries the decision's own identity — the ring `id` and the state version
 * the search ran on — because a pasted refusal with no `seq` names no board,
 * and the report exists to be pasted into an issue.
 */
export function formatRefusalReport(
    refusal: VerdictQuizRefusal,
    decision: { id: number; seq?: number }
): string {
    const { title, trackedBy } = QUIZ_REFUSALS[refusal.kind];
    const lines = [
        `verdict quiz refusal: ${refusal.kind}`,
        title,
        "",
        refusal.detail,
        "",
        `decision #${decision.id}${
            decision.seq === undefined ? "" : ` at seq ${decision.seq}`
        }`,
    ];
    if (trackedBy !== null) {
        lines.push(`tracked by issue #${trackedBy}`);
    }
    if (refusal.dropped.length > 0) {
        lines.push("", `not captured (${refusal.dropped.length}):`);
        for (const note of refusal.dropped) lines.push(`- ${note}`);
    }
    return lines.join("\n");
}

export type VerdictQuizResult =
    | { ok: true; quiz: VerdictQuiz }
    | { ok: false; refusal: VerdictQuizRefusal };

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
        : {
              ok: false,
              refusal: quizRefusal(
                  outcome.kind,
                  outcome.error,
                  outcome.dropped
              ),
          };
}
