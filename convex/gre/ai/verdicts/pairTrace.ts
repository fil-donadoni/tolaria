// Building a derived right-hand half, and the trace check (issue #4795,
// PRD #4792, ADR 0148).
//
// `pairDerivation.ts` writes the half's position; this module BUILDS it through
// the same production blade builder every verdict is rebuilt with
// (`buildVerdictState`), so a `sequence` half's earlier move runs through the
// real engine and a step that finds no purchase throws `BladeSetupError`,
// exactly as a blade entry's `setup` does. It then finds the judged move on
// the half — the move the anchor ruled out, which the half says is right.
//
// FINDING THE MOVE. By key first; a key carries instance ids, which a `card`
// Discriminant legitimately reallocates (`minimalPair.ts`, header), so a key
// that misses falls back to the move describer's sentence — the other half of
// a candidate's identity (`types.ts`, `VerdictCandidate`). Two moves reading
// the same sentence are refused rather than guessed between.
//
// THE TRACE CHECK (ADR 0148: "a move that leaves no trace on the board yields
// two identical feature vectors and the pair is refused, like the `history`
// gap"). It is a `sequence` check: an earlier move whose only residue is that
// it was made — a decision history, not a board — gives the judged move ONE
// feature vector in both halves, so the pair asks the Weight Fit to rank one
// vector both below and above its alternatives, which no weight satisfies.
// The `history` gap (`registrySource.ts`) refuses a blade entry for the same
// reason, and making "move already made" visible to the Evaluation is out of
// scope (PRD #4792). It is deliberately NOT applied to the other kinds: a
// `step` or `card` pair whose halves the Evaluation cannot tell apart is the
// pair the fit report exists to name — "the Discriminant no term reads" (PRD
// #4792, user story 18) — and refusing it here would silence that diagnosis.

import { describeMove } from "../../describeMove";
import type { Move } from "../../moves";
import { decidingPlayer, moveKey } from "../../search";
import type { GameState } from "../../state";
import { seatPlayerId } from "../blade/matcher";
import { candidateFeatures, resolveVerdictMoves } from "./evalPairs";
import type { FeatureVector } from "./features";
import {
    deriveRightHalfPosition,
    type DiscriminantChange,
    type PairPosition,
} from "./pairDerivation";
import { buildVerdictState, candidateMoves } from "./position";
import type { Discriminant, Verdict, VerdictCandidate } from "./types";

/** Why a derived half cannot stand as a Minimal Pair — reported, like a
 *  `VerdictGap`, never silently dropped. `no-trace`: the `sequence` move left
 *  nothing the Evaluation reads (header). `not-deciding`: the anchor's seat
 *  owes no decision on the half. `move-missing`: the half does not offer the
 *  judged move, or offers two that read the same. */
export type PairRefusal = {
    reason: "no-trace" | "not-deciding" | "move-missing";
    detail: string;
};

export type BuiltRightHalf =
    | {
          position: PairPosition;
          state: GameState;
          /** The judged move, found on the half's own enumeration. */
          move: Move;
          candidate: VerdictCandidate;
      }
    | { position: PairPosition; refusal: PairRefusal };

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
    botId: string,
    judged: VerdictCandidate
): Move | PairRefusal {
    const moves = candidateMoves(state, botId);
    const byKey = moves.find((m) => moveKey(m) === judged.key);
    if (byKey) return byKey;
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

const sameVector = (a: FeatureVector, b: FeatureVector): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

/**
 * Derive the right-hand half of `anchor` for `discriminant`, build it through
 * the real engine, and find `judged` — the move the anchor ruled out — on it.
 * Throws what the derivation throws (`PairDerivationError`) and what the
 * builder throws (`BladeSetupError` for a `sequence` step with no purchase);
 * returns a `refusal` for a half that builds but cannot stand as a pair.
 */
export function buildRightHalf(
    anchor: Verdict,
    discriminant: Discriminant,
    change: DiscriminantChange,
    judged: VerdictCandidate
): BuiltRightHalf {
    const position = deriveRightHalfPosition(anchor, discriminant, change);
    const state = buildVerdictState(asVerdict(anchor, position));
    const botId = seatPlayerId(state, position.seat);
    if (decidingPlayer(state) !== botId) {
        return {
            position,
            refusal: {
                reason: "not-deciding",
                detail: `seat "${position.seat}" owes no decision on the right-hand half`,
            },
        };
    }
    const move = findJudgedMove(state, botId, judged);
    if ("reason" in move) return { position, refusal: move };

    if (discriminant.kind === "sequence") {
        const anchorState = buildVerdictState(anchor);
        const anchorBot = seatPlayerId(anchorState, anchor.seat);
        const resolved = resolveVerdictMoves(
            { ...anchor, candidates: [judged] },
            anchorState,
            anchorBot
        );
        if ("error" in resolved) {
            throw new Error(
                `the anchor ${anchor.id} no longer offers its judged move: ${resolved.error}`
            );
        }
        const before = candidateFeatures(
            anchorState,
            anchorBot,
            resolved.moves[0]
        );
        const after = candidateFeatures(state, botId, move);
        if (sameVector(before, after)) {
            return {
                position,
                refusal: {
                    reason: "no-trace",
                    detail: `the earlier move (${discriminant.detail}) leaves no trace on the board: "${judged.description}" carries one feature vector in both halves, so no weight could rank it wrong in one and right in the other`,
                },
            };
        }
    }
    return {
        position,
        state,
        move,
        candidate: {
            key: moveKey(move),
            description: describeMove(move, state),
        },
    };
}
