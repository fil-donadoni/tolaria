// Building a prefilled right-hand half in the browser (issue #4800, PRD #4792,
// ADR 0148).
//
// `verdict-pair.ts` writes the half's POSITION; this module BUILDS it through
// the same production blade builder every verdict is rebuilt with, finds the
// move the anchor ruled out on it, and lists the candidates the half offers —
// the list its stored answer indexes into. The engine graph this reaches is not
// small, so the quiz loads it with a dynamic import, the way it loads
// `verdict-quiz` (`ai-decision-verdict-quiz.tsx`).
//
// EVERYTHING THAT CAN GO WRONG COMES BACK AS A REASON, never a throw: the
// derivation's own refusals (`no-change`, `no-trace`, `not-deciding`,
// `move-missing`) and the builder's (`BladeSetupError` for a `sequence` step
// with no purchase, an unknown card name). A tester reads a sentence; a thrown
// error would be a blank panel.

import { describeMove } from "@convex/gre/describeMove";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import { buildRightHalf } from "@convex/gre/ai/verdicts/pairTrace";
import type { PairPosition } from "@convex/gre/ai/verdicts/pairDerivation";
import { candidateMoves } from "@convex/gre/ai/verdicts/position";
import { moveKey } from "@convex/gre/search";
import type {
    Discriminant,
    Verdict,
    VerdictCandidate,
} from "@convex/gre/ai/verdicts/types";
import { QUIZ_SEAT, type VerdictQuiz } from "./verdict-quiz";

export type RightHalfCheck =
    | {
          ok: true;
          /** The candidates the half offers, in enumeration order. */
          candidates: VerdictCandidate[];
          /** The judged move's index in them. */
          rightIndex: number;
      }
    | { ok: false; reason: string; detail: string };

/** The anchor as a `Verdict`, which is what the derivation's build takes. */
function anchorVerdict(quiz: VerdictQuiz, wrongIndex: number): Verdict {
    return {
        id: "quiz:anchor",
        spec: quiz.spec,
        seat: QUIZ_SEAT,
        candidates: quiz.candidates,
        answer: { kind: "forbidden", forbiddenIndexes: [wrongIndex] },
        author: "quiz",
        createdAt: "",
        source: "in-play",
    };
}

/**
 * Build `position` as the right-hand half of the quiz's anchor and say whether
 * it can stand: the half's candidate list and where the judged move sits in it,
 * or the reason it cannot.
 */
export function checkRightHalf(
    quiz: VerdictQuiz,
    wrongIndex: number,
    discriminant: Discriminant,
    position: PairPosition
): RightHalfCheck {
    try {
        const built = buildRightHalf(
            anchorVerdict(quiz, wrongIndex),
            discriminant,
            position,
            quiz.candidates[wrongIndex]
        );
        if ("refusal" in built) {
            return { ok: false, ...built.refusal };
        }
        const botId = seatPlayerId(built.state, position.seat);
        const candidates = candidateMoves(built.state, botId).map((move) => ({
            key: moveKey(move),
            description: describeMove(move, built.state),
        }));
        const rightIndex = candidates.findIndex(
            (candidate) => candidate.key === built.candidate.key
        );
        return { ok: true, candidates, rightIndex };
    } catch (cause) {
        return {
            ok: false,
            reason: "build-threw",
            detail: `the right-hand position could not be built: ${
                cause instanceof Error ? cause.message : `${cause}`
            }`,
        };
    }
}
