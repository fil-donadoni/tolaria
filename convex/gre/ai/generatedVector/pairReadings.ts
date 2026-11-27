// The generated vector's reading of a set of Eval Pairs (issue #10857): for
// each pair, the difference between its two candidates' generated vectors and
// whether the two are one move up to which copy of a card. The census that
// consumes it is pure (`verdicts/generatedCoverage.ts`); this is the half that
// rebuilds positions.
//
// Each verdict's position is rebuilt ONCE and each candidate probed once, on
// the board `candidateFeatures` reads the Eval Pair off
// (`candidateGeneratedVector`), so "blind today, different under the generated
// vector" is one settled board read two ways.
//
// Kept out of the barrel, like `candidate.ts`: it reaches the search.

import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { makeInterchangeableKeyer } from "../interchangeable";
import { seatPlayerId } from "../blade/matcher";
import { resolveVerdictMoves, type EvalPair } from "../verdicts/evalPairs";
import type { GeneratedPairReading } from "../verdicts/generatedCoverage";
import { buildVerdictState } from "../verdicts/position";
import type { Verdict } from "../verdicts/types";
import { candidateGeneratedVector } from "./candidate";
import { namedEntries, subtractVectors, type GeneratedVector } from "./vector";

/** The reading of every pair in `pairs`, keyed by the pair object. Throws on
 *  a pair whose verdict is not in `verdicts` or no longer rebuilds: a pair
 *  exists only because its verdict did, so a miss is a corpus handed in
 *  wrong, never a pair to skip. */
export function generatedPairReadings(
    verdicts: readonly Verdict[],
    pairs: readonly EvalPair[],
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): Map<EvalPair, GeneratedPairReading> {
    const byId = new Map(verdicts.map((v) => [v.id, v]));
    const pairsOf = new Map<string, EvalPair[]>();
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const list = pairsOf.get(pair.verdictId);
        if (list) list.push(pair);
        else pairsOf.set(pair.verdictId, [pair]);
    }

    const out = new Map<EvalPair, GeneratedPairReading>();
    pairsOf.forEach((verdictPairs, verdictId) => {
        const verdict = byId.get(verdictId);
        if (!verdict) {
            throw new Error(`generated reading: no verdict ${verdictId}`);
        }
        const state = buildVerdictState(verdict);
        const botId = seatPlayerId(state, verdict.seat);
        const resolved = resolveVerdictMoves(verdict, state, botId);
        if ("error" in resolved) {
            throw new Error(
                `generated reading of ${verdictId}: ${resolved.error}`
            );
        }
        const { moves } = resolved;
        const keyOf = makeInterchangeableKeyer(state);
        const vectors = new Map<number, GeneratedVector>();
        const vectorAt = (index: number): GeneratedVector => {
            const cached = vectors.get(index);
            if (cached) return cached;
            const vector = candidateGeneratedVector(
                state,
                botId,
                moves[index],
                weights
            );
            vectors.set(index, vector);
            return vector;
        };
        for (let i = 0; i < verdictPairs.length; i++) {
            const pair = verdictPairs[i];
            out.set(pair, {
                difference: namedEntries(
                    subtractVectors(
                        vectorAt(pair.rightIndex),
                        vectorAt(pair.otherIndex)
                    )
                ),
                vacuous:
                    keyOf(moves[pair.rightIndex]) ===
                    keyOf(moves[pair.otherIndex]),
            });
        }
    });
    return out;
}
