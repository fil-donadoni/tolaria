// Verdict → Eval Pairs (issue #3400, PRD #3397, ADR 0124 §2).
//
// An Eval Pair is the evaluation's OWN correctness metric, beside the blade
// suite's: the board after the right move must outscore the board after every
// other candidate under the evaluation alone — no search, microseconds. This
// module is the bridge, and it is deliberately thin: it rebuilds the position,
// re-enumerates, applies each candidate through the SAME 1-ply settled probe
// the rollout policy uses (`policyProbeState` + `policyValueOfSettled`,
// `search.ts`), and differences the feature vectors.
//
// WHY THE PRODUCTION PROBE AND NOT A LOCAL ONE. The pair's whole claim is
// "the decider ranks these two the wrong way round". A bridge that cloned,
// applied and evaluated on its own would be measuring a decider nobody uses:
// it would miss the one-resolution lookahead (so removal would look like pure
// cost), the mover-owned settle of a suspended resolution (issue #3293: a
// creature that has entered but not yet been sacrificed), and the two combat
// corrections `policyValue` folds in. The seam exists precisely so this cannot
// happen, and splitting `policyValue` in two (issue #3400) is what lets the
// probe run once while the SCORING runs once per fittable weight.
//
// THE TWO CONSTRAINT SHAPES. A `right` verdict yields one pair per other
// candidate: right must outrank each. A `forbidden` verdict — the blade
// `forbidden` expectation, which names no right answer because its author
// did not claim to know one — yields the weaker "the best non-forbidden
// candidate must outrank this forbidden one", one pair per forbidden
// candidate. "Best" is read under the CURRENT weights, which makes the pair
// weight-dependent: it is a statement about the ordering a specific evaluation
// produces, and a refit re-derives it. Documented rather than hidden, because
// a fit consuming these must know that the forbidden constraints move under it
// while the `right` ones do not.

import { cloneGameState } from "../../clone";
import type { EvalTerms } from "../../evaluate";
import type { Move } from "../../moves";
import type { GameState } from "../../state";
import {
    applyMoveInSearch,
    decidingPlayer,
    moveKey,
    policyProbeState,
} from "../../search";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { seatPlayerId } from "../blade/matcher";
import {
    featuresOfSettled,
    scoreBasis,
    subtractBasis,
    subtractTerms,
    type FeatureVector,
    type FittableWeightKey,
} from "./features";
import { buildVerdictState, candidateMoves } from "./position";
import type { Verdict, VerdictCandidate } from "./types";

/** One constraint the evaluation must satisfy: `right` must outrank `other`. */
export type EvalPair = {
    verdictId: string;
    /** `right` — the judge named this candidate. `forbidden` — the judge only
     *  ruled the other one out, and `right` is whichever non-forbidden
     *  candidate the current weights like best. */
    kind: "right" | "forbidden";
    rightIndex: number;
    otherIndex: number;
    right: VerdictCandidate;
    other: VerdictCandidate;
    /** `x(right) − x(other)` over the evaluation's per-term breakdown, in
     *  margin points — the human-readable half. */
    terms: Record<keyof EvalTerms, number>;
    /** `x(right) − x(other)` over the fittable, unweighted basis — the `x` of
     *  ADR 0124 §3's `w · (x(right) − x(other)) ≥ δ`. */
    basis: Record<FittableWeightKey, number>;
    /** `w · basis` under the weights the pair was built with: the part of the
     *  gap a weight fit can actually move. */
    fittableDelta: number;
    /** The FULL policy-value gap, fittable part plus residual. Positive means
     *  the evaluation already ranks the pair correctly — this is the number
     *  the 1-ply greedy decider orders on, so it, not `fittableDelta`, is what
     *  "satisfied" means. */
    delta: number;
};

/** Everything one verdict produced: its candidates' feature vectors, the
 *  pairs, and — when the position no longer yields them — why not. */
export type VerdictPairs = {
    verdict: Verdict;
    pairs: EvalPair[];
    /** One per candidate, in the verdict's own candidate order. Empty when
     *  the verdict could not be evaluated. */
    features: FeatureVector[];
    /** Non-empty when the verdict yielded no pairs. A REBUILT position that no
     *  longer offers the judged candidates is a finding (the verdict has gone
     *  stale against the engine), never something to paper over. */
    error?: string;
};

/** The settled 1-ply probe of one candidate, and its features. Exported so a
 *  test can assert on one candidate without building the pairs. */
export function candidateFeatures(
    state: GameState,
    botId: string,
    move: Move,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): FeatureVector {
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, botId, move);
    // `moverId` is the bot itself: a verdict is always about the seat that
    // owed the decision, so the settle may answer the choices that seat owns.
    const settled = policyProbeState(probe, move, weights, botId);
    return featuresOfSettled(settled, botId, weights);
}

/**
 * The Eval Pairs a verdict yields under `weights`.
 *
 * Rebuilds the position through the production blade builder, re-enumerates
 * through the production enumerator, and matches the verdict's candidates BY
 * KEY. A key the rebuilt position no longer offers is an error on the whole
 * verdict rather than a dropped candidate: a pair set missing the very move
 * the judge ruled out would silently assert something weaker than what was
 * said.
 */
export function evalPairsOf(
    verdict: Verdict,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): VerdictPairs {
    const fail = (error: string): VerdictPairs => ({
        verdict,
        pairs: [],
        features: [],
        error,
    });

    let state: GameState;
    try {
        state = buildVerdictState(verdict);
    } catch (error) {
        return fail(
            `position could not be rebuilt: ${
                error instanceof Error ? error.message : `${error}`
            }`
        );
    }

    const botId = seatPlayerId(state, verdict.seat);
    if (decidingPlayer(state) !== botId) {
        return fail(
            `seat "${verdict.seat}" owes no decision on the rebuilt position`
        );
    }

    const byKey = new Map<string, Move>();
    for (const move of candidateMoves(state, botId))
        byKey.set(moveKey(move), move);

    const moves: Move[] = [];
    for (const candidate of verdict.candidates) {
        const move = byKey.get(candidate.key);
        if (!move) {
            return fail(
                `candidate no longer enumerated on the rebuilt position: ${candidate.description}`
            );
        }
        moves.push(move);
    }

    const features = moves.map((move) =>
        candidateFeatures(state, botId, move, weights)
    );

    const pairOf = (
        kind: EvalPair["kind"],
        rightIndex: number,
        otherIndex: number
    ): EvalPair => {
        const basis = subtractBasis(
            features[rightIndex].basis,
            features[otherIndex].basis
        );
        return {
            verdictId: verdict.id,
            kind,
            rightIndex,
            otherIndex,
            right: verdict.candidates[rightIndex],
            other: verdict.candidates[otherIndex],
            terms: subtractTerms(
                features[rightIndex].terms,
                features[otherIndex].terms
            ),
            basis,
            fittableDelta: scoreBasis(basis, weights),
            delta:
                features[rightIndex].policyValue -
                features[otherIndex].policyValue,
        };
    };

    // BOTH answer shapes reduce to the same constraint — "the best of the
    // allowed set must outrank every disallowed candidate" — because both say
    // the same kind of thing about a DECIDER that picks one move: a `right`
    // verdict is satisfied when the pick is in its set, a `forbidden` one when
    // the pick is outside its set. The two differ only in which side of the
    // partition the judge named.
    const named = new Set(
        verdict.answer.kind === "right"
            ? verdict.answer.rightIndexes
            : verdict.answer.forbiddenIndexes
    );
    const indexes = moves.map((_, i) => i);
    const allowed =
        verdict.answer.kind === "right"
            ? indexes.filter((i) => named.has(i))
            : indexes.filter((i) => !named.has(i));
    const disallowed = indexes.filter((i) => !allowed.includes(i));
    if (allowed.length === 0) return fail("no candidate is allowed");
    if (disallowed.length === 0) {
        return fail("every candidate is allowed — no constraint to express");
    }
    // "Best" under the CURRENT weights, ties broken by candidate order so the
    // choice is deterministic. That makes a MULTI-candidate constraint
    // weight-dependent — it is a statement about the ordering a specific
    // evaluation produces, and a refit re-derives it. A single-candidate
    // `right` verdict (every in-play one) has no choice to make and is
    // therefore weight-independent, which is the common case.
    const best = allowed.reduce((a, b) =>
        features[b].policyValue > features[a].policyValue ? b : a
    );
    const pairs = disallowed.map((i) => pairOf(verdict.answer.kind, best, i));
    return { verdict, pairs, features };
}
