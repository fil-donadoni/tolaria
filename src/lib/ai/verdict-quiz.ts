// The verdict quiz's model: one Bot decision, lowered into the thing a Verdict
// is made of (issue #3405, PRD #3397, ADR 0124 §1).
//
// WHY THE CANDIDATE LIST IS REBUILT AND NOT READ OFF THE TRACE. A verdict is a
// POSITION AND AN ANSWER: `spec` plus candidates named by the structural move
// key `moveKey` produces. The trace in the box holds `Move` objects too — but
// they carry the INSTANCE IDS of the live game, and the fit never sees that
// game: `evalPairsOf` rebuilds the board from the spec, re-enumerates, and
// matches the verdict's candidates BY KEY. Ids allocated by that rebuild are
// not the live game's, so a key taken from the trace would resolve against
// nothing and the whole verdict would come back "candidate no longer
// enumerated" at fit time — far from the tester who could still say what they
// meant.
//
// So the lowering does here, once, exactly what the fit will do later: build
// the position through the SAME `buildVerdictState`, enumerate through the SAME
// `candidateMoves`, and key the candidates off THAT. What the trace is used for
// is the one thing the rebuild cannot know — which of those candidates the Bot
// itself picked — matched through the move describer's sentence, the same
// vocabulary the box already renders.
//
// Every failure is returned as data. A position that cannot be lowered, a
// rebuild the seat no longer owes a decision on, a pick the rebuilt list does
// not contain: each is a fact about this decision that the tester must SEE
// before submitting, never a thrown error inside a debug panel.

import { specFromState } from "@convex/gre/scenarioBuilder";
import { describeMove } from "@convex/gre/describeMove";
import { moveKey, decidingPlayer } from "@convex/gre/search";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import {
    buildVerdictState,
    candidateMoves,
} from "@convex/gre/ai/verdicts/position";
import type { Verdict, VerdictCandidate } from "@convex/gre/ai/verdicts/types";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { DecisionTrace } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";
import type { AiTraceSource } from "./trace-store";

/** The judged seat, in the spec's own frame. Always `"me"`: the lowering below
 *  names the Bot's seat as `"me"`, which is `ScenarioSpec`'s `players[0]`
 *  convention (`gre/ai/blade/types.ts`). */
export const QUIZ_SEAT = "me" as const;

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
    | { ok: false; error: string };

/** A Verdict shaped just enough to build its position. The candidates are what
 *  this function is about to derive, and the answer is what the tester has not
 *  given yet — neither is read by `buildVerdictState`, which wants the spec,
 *  the seat and (here, never) the setup steps. */
function provisionalVerdict(spec: ScenarioSpec): Verdict {
    return {
        id: "in-play",
        spec,
        seat: QUIZ_SEAT,
        candidates: [],
        answer: { kind: "right", rightIndexes: [] },
        author: "in-play",
        createdAt: new Date(0).toISOString(),
        source: "in-play",
    };
}

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

    let spec: ScenarioSpec;
    let dropped: string[];
    try {
        const lowered = specFromState(position, { mySeatId: source.botId });
        spec = lowered.spec;
        dropped = lowered.dropped;
    } catch (error) {
        return {
            ok: false,
            error: `this position could not be lowered into a scenario: ${message(error)}`,
        };
    }

    let rebuilt: GameState;
    try {
        rebuilt = buildVerdictState(provisionalVerdict(spec));
    } catch (error) {
        return {
            ok: false,
            error: `the lowered position could not be rebuilt: ${message(error)}`,
        };
    }

    const seatId = seatPlayerId(rebuilt, QUIZ_SEAT);
    if (decidingPlayer(rebuilt) !== seatId) {
        // The same check `evalPairsOf` runs before it builds a pair. Caught
        // here it is a sentence in the panel; caught there it is a verdict in
        // git that never meant anything.
        return {
            ok: false,
            error: "the rebuilt position owes the Bot no decision — what it was deciding did not survive the lowering (see the stack or combat notes above)",
        };
    }

    const moves = candidateMoves(rebuilt, seatId);
    if (moves.length < 2) {
        // A one-candidate list is what `collectVerdictReport` calls
        // UNCONSTRAINING: every decider takes the only legal line, so the
        // judgement states no preference and the fit can build no pair from it.
        // The mutation would accept it and the corpus would carry a row that
        // means nothing.
        return {
            ok: false,
            error: "the rebuilt position offers only one move — a verdict there would state no preference",
        };
    }

    const candidates: VerdictCandidate[] = moves.map((move) => ({
        key: moveKey(move),
        description: describeMove(move, rebuilt),
    }));

    // The Bot's pick, by the describer's sentence — the only vocabulary the
    // live decision and the rebuilt position share (the ids underneath differ
    // by construction). `findIndex` takes the first match: two candidates can
    // describe identically only when they are the same play on interchangeable
    // cards, in which case either index names the move that was made.
    const botPickIndex = candidates.findIndex(
        (candidate) => candidate.description === trace.chosen
    );
    if (botPickIndex === -1) {
        // The rebuild does not offer the move that was actually played, so it
        // is not this decision: the lowering lost something the decision
        // depended on (a declared combat, a spell on the stack, a mana pool).
        // Judging the list anyway would file an answer about a DIFFERENT
        // position under the Bot's name — the one failure of this whole flow
        // that nothing downstream could ever detect, because the verdict it
        // produces rebuilds and enumerates perfectly.
        return {
            ok: false,
            error: `the Bot played "${trace.chosen}", which the rebuilt position does not offer — this decision cannot be captured as a scenario${
                dropped.length > 0
                    ? ` (not captured: ${dropped.join("; ")})`
                    : ""
            }`,
        };
    }

    return { ok: true, quiz: { spec, candidates, botPickIndex, dropped } };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}
