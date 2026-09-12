// The candidate set a Verdict is judged over, and the position it is judged on
// when no setup steps are involved — the PURE half of `position.ts`
// (issue #3400, split by issue #3405).
//
// It is split because the browser needs it. `position.ts` reaches the blade
// RUNNER — the harness and its 6.6k-line registry — and the in-play verdict
// quiz has to rebuild the position and re-enumerate IN THE BROWSER, with the
// same functions the fit uses months later: otherwise the candidate keys it
// submits resolve against nothing when `evalPairsOf` re-enumerates.
//
// What it is NOT is a second builder. Until issue #3479 it was: `blade/setup`
// imported `convex/game`, whose line-4 `./auth` import the client-bundle purity
// guard (ADR 0074) refuses from `src/`, so the browser could not replay a
// single setup step and this module hand-rolled the setup-free half of
// `buildBladeState`. The activation path now lives in `gre/activation.ts` and
// the builder in `blade/build.ts`, both pure, so `buildSetupFreeVerdictState`
// is a CALL into the production builder with no steps — and a position whose
// pending decision comes from a real activation is replayable here too, which
// is what the journal slice needs. `verdictStatesAgree` (its test) still pins
// it to `buildVerdictState`, so a future re-fork reds.

import { enumerateMoves, type Move } from "../../moves";
import type { GameState } from "../../state";
import { beginDominanceDecision, endDominanceDecision } from "../dominance";
import { buildPositionFromSpec } from "../blade/build";
import type { BladeSetupStep } from "../blade/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** The candidate set a verdict is judged over: EXACTLY the one the deciders
 *  see (`greedyRootPick` / `search` — dominance-pruned `enumerateMoves`), so a
 *  verdict can never name a move the Bot was never offered, and a pair can
 *  never be built against one. */
export function candidateMoves(state: GameState, playerId: string): Move[] {
    beginDominanceDecision();
    try {
        return enumerateMoves(state, playerId, { pruneDominatedNoOps: true });
    } finally {
        endDominanceDecision();
    }
}

/** The position a verdict names, replayed through the PRODUCTION builder —
 *  the same one `buildVerdictState` and the blade harness call, so there is no
 *  second way to build it. Instance ids are allocated by this build, which is
 *  why the quiz keys its candidates off THIS state and not off the live game's.
 *
 *  `setup` is the engine-real step sequence a `Verdict` may carry
 *  (`verdicts/types.ts`); replaying it in the browser is what issue #3479 made
 *  possible. A step that finds no purchase throws `BladeSetupError` (ADR 0070
 *  §4) rather than approximating the position. */
export function buildVerdictPosition(
    spec: ScenarioSpec,
    setup?: BladeSetupStep[]
): GameState {
    return buildPositionFromSpec(spec, setup, "verdict");
}

/** The setup-LESS case: a decision taken on an EMPTY stack, where there is
 *  nothing to walk. Since issue #3480 a decision taken over a stack goes
 *  through `buildVerdictPosition` with the journal's steps instead. Kept as its
 *  own name because that is what its callers mean, and because
 *  `verdictStatesAgree` pins it. */
export function buildSetupFreeVerdictState(spec: ScenarioSpec): GameState {
    return buildVerdictPosition(spec);
}
