// The generated vector of ONE candidate move (issue #10853).
//
// An Eval Pair compares two candidates by the feature vectors of the boards
// they lead to (ADR 0124 §3). This reads the generated vector off the SAME
// board `candidateFeatures` reads the fitted basis off — the candidate's
// settled 1-ply probe — so "the two candidates share a feature vector today
// and differ in the generated one" is a statement about one board read two
// ways, not about two probes.
//
// Kept out of the barrel: it reaches the search through the probe.

import type { Move } from "../../moves";
import type { GameState } from "../../state";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { candidateSettledState } from "../verdicts/evalPairs";
import { generatedVector } from "./generate";
import type { GeneratedVector } from "./vector";

/** The generated vector of the board `move` leads to, read for `botId`. */
export function candidateGeneratedVector(
    state: GameState,
    botId: string,
    move: Move,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): GeneratedVector {
    return generatedVector(
        candidateSettledState(state, botId, move, weights),
        botId
    );
}
