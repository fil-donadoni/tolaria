// Building a derived right-hand half, and the trace check (issue #4795,
// PRD #4792, ADR 0148).
//
// `pairDerivation.ts` writes the half's position — the prefill a tester
// confirms or touches up; this module BUILDS the position that comes back,
// through the same production blade builder every verdict is rebuilt with
// (`buildVerdictState`), so a `sequence` half's earlier move runs through the
// real engine and a step that finds no purchase throws `BladeSetupError`,
// exactly as a blade entry's `setup` does. It then finds the judged move on
// the half — the move the anchor ruled out, which the half says is right.
//
// A HALF THAT IS THE ANCHOR is refused before anything is built: an `other`
// prefill left untouched, or an edit that sets a figure to the value it
// already had, is the anchor's own position under a second, opposite answer —
// one position key, two answers, which is a Contested Position, not a pair.
//
// FINDING THE MOVE. By key first, but a key carries instance ids, and a `card`
// Discriminant legitimately reallocates them (`minimalPair.ts`, header) — the
// anchor's key can then name a DIFFERENT move on the half. So a key match
// stands only when the half's describer reads it as the judged sentence, and
// otherwise the sentence alone decides — the other half of a candidate's
// identity (`types.ts`, `VerdictCandidate`). Two moves reading the same
// sentence are refused rather than guessed between.
//
// THE TRACE CHECK (ADR 0148: "a move that leaves no trace on the board yields
// two identical feature vectors and the pair is refused, like the `history`
// gap"). It is a `sequence` check: an earlier move whose only residue is that
// it was made — a decision history, not a board — leaves the Evaluation
// looking at the same position twice. "The same" is read over the WHOLE
// candidate set, not the judged move alone: an Eval Pair constrains the
// DIFFERENCE between the judged move and each alternative (`evalPairs.ts`), so
// the judged move keeping its vector while an alternative's moves is a pair
// some weight can still satisfy. Only when every candidate, sentence for
// sentence, carries one vector in both halves does the pair ask the fit to
// rank one vector both below and above the same alternatives. The `history`
// gap (`registrySource.ts`) refuses a blade entry for the same reason, and
// making "move already made" visible to the Evaluation is out of scope (PRD
// #4792).
//
// It is deliberately NOT applied to the other kinds, though PRD #4792 words
// the check generically: user story 8 and ADR 0148 scope it to `sequence`,
// and a `step` or `card` pair whose halves the Evaluation cannot tell apart is
// the pair the fit report exists to name — "the Discriminant no term reads"
// (user story 18). Refusing it here would silence that diagnosis.

import { describeMove } from "../../describeMove";
import type { Move } from "../../moves";
import { decidingPlayer, moveKey } from "../../search";
import type { GameState } from "../../state";
import { seatPlayerId } from "../blade/matcher";
import { candidateFeatures } from "./evalPairs";
import { canonicalJson } from "./identity";
import { positionOf, type PairPosition } from "./pairDerivation";
import { buildVerdictState, candidateMoves } from "./position";
import type { Discriminant, Verdict, VerdictCandidate } from "./types";

/** Why a derived half cannot stand as a Minimal Pair — reported, like a
 *  `VerdictGap`, never silently dropped. `no-change`: the half IS the
 *  anchor's position (header). `no-trace`: the `sequence` move left nothing
 *  the Evaluation reads (header). `not-deciding`: the anchor's seat owes no
 *  decision on the half. `move-missing`: the half does not offer the judged
 *  move, or offers two that read the same. */
export type PairRefusal = {
    reason: "no-change" | "no-trace" | "not-deciding" | "move-missing";
    detail: string;
};

export type BuiltRightHalf =
    | {
          state: GameState;
          /** The judged move, found on the half's own enumeration. */
          move: Move;
          candidate: VerdictCandidate;
      }
    | { refusal: PairRefusal };

/** The half as a verdict, so it rebuilds through `buildVerdictState`. */
const asVerdict = (anchor: Verdict, position: PairPosition): Verdict => {
    const verdict: Verdict = {
        ...anchor,
        spec: position.spec,
        seat: position.seat,
    };
    delete verdict.setup;
    delete verdict.deckKnowledge;
    if (position.setup?.length) verdict.setup = position.setup;
    if (position.deckKnowledge?.length) {
        verdict.deckKnowledge = position.deckKnowledge;
    }
    return verdict;
};

function findJudgedMove(
    state: GameState,
    moves: Move[],
    judged: VerdictCandidate
): Move | PairRefusal {
    const byKey = moves.find((m) => moveKey(m) === judged.key);
    if (byKey && describeMove(byKey, state) === judged.description) {
        return byKey;
    }
    const bySentence = moves.filter(
        (m) => describeMove(m, state) === judged.description
    );
    if (bySentence.length === 1) return bySentence[0];
    return {
        reason: "move-missing",
        detail:
            bySentence.length === 0
                ? `the right-hand half does not offer the judged move: ${judged.description}`
                : `the right-hand half offers ${bySentence.length} moves reading "${judged.description}" — the judged one is ambiguous`,
    };
}

/** Every candidate's feature vector, keyed by the describer's sentence — the
 *  vocabulary two builds share. */
function vectorsBySentence(
    state: GameState,
    botId: string,
    moves: Move[]
): string {
    const rows = moves.map((move) => [
        describeMove(move, state),
        canonicalJson(candidateFeatures(state, botId, move)),
    ]);
    return canonicalJson(rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Build `position` — the right-hand half of `anchor` for `discriminant`, as
 * `deriveRightHalfPosition` prefilled it and a tester confirmed or touched it
 * up — through the real engine, and find `judged`, the move the anchor ruled
 * out, on it. Throws what the builder throws (`BladeSetupError` for a
 * `sequence` step with no purchase); returns a `refusal` for a half that
 * cannot stand as a pair.
 */
export function buildRightHalf(
    anchor: Verdict,
    discriminant: Discriminant,
    position: PairPosition,
    judged: VerdictCandidate
): BuiltRightHalf {
    if (
        canonicalJson(positionOf(anchor)) ===
        canonicalJson(positionOf(position))
    ) {
        return {
            refusal: {
                reason: "no-change",
                detail: `the right-hand half is the anchor's own position — nothing realises the Discriminant (${discriminant.kind}: ${discriminant.detail})`,
            },
        };
    }
    const state = buildVerdictState(asVerdict(anchor, position));
    const botId = seatPlayerId(state, position.seat);
    if (decidingPlayer(state) !== botId) {
        return {
            refusal: {
                reason: "not-deciding",
                detail: `seat "${position.seat}" owes no decision on the right-hand half`,
            },
        };
    }
    const moves = candidateMoves(state, botId);
    const move = findJudgedMove(state, moves, judged);
    if ("reason" in move) return { refusal: move };

    if (discriminant.kind === "sequence") {
        const anchorState = buildVerdictState(anchor);
        const anchorBot = seatPlayerId(anchorState, anchor.seat);
        const before = vectorsBySentence(
            anchorState,
            anchorBot,
            candidateMoves(anchorState, anchorBot)
        );
        if (before === vectorsBySentence(state, botId, moves)) {
            return {
                refusal: {
                    reason: "no-trace",
                    detail: `the earlier move (${discriminant.detail}) leaves no trace on the board: every candidate, "${judged.description}" among them, carries one feature vector in both halves, so no weight could rank it wrong in one and right in the other`,
                },
            };
        }
    }
    return {
        state,
        move,
        candidate: {
            key: moveKey(move),
            description: describeMove(move, state),
        },
    };
}
