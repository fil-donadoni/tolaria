// The candidate set a Verdict is judged over, and the position it is judged on
// when no setup steps are involved — the PURE half of `position.ts`
// (issue #3400, split by issue #3405).
//
// It is split because the browser needs it. `position.ts` builds through
// `buildBladeState`, which reaches `blade/setup` → `convex/game` → the Convex
// function shell, and the client-bundle purity guard (ADR 0074) refuses that
// import from `src/`. The in-play verdict quiz nevertheless has to rebuild the
// position and re-enumerate IN THE BROWSER, with the same functions the fit
// uses months later — otherwise the candidate keys it submits resolve against
// nothing when `evalPairsOf` re-enumerates.
//
// So the two functions a setup-less verdict needs live here, `position.ts`
// re-exports `candidateMoves`, and `verdictStatesAgree` (its test) pins
// `buildSetupFreeVerdictState` to `buildVerdictState` so the split cannot
// become a fork.

import { buildStateFromScenario } from "../../scenarioBuilder";
import { enumerateMoves, type Move } from "../../moves";
import type { GameState } from "../../state";
import { beginDominanceDecision, endDominanceDecision } from "../dominance";
import { buildBladeBaseState } from "../blade/baseState";
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

/** The position a verdict WITHOUT setup steps names — the first half of
 *  `buildBladeState`, which for such a scenario is the whole of it
 *  (`applyBladeSetup` on an empty step list is the identity, pinned by the
 *  agreement test). Instance ids are allocated by this build, which is why the
 *  quiz keys its candidates off THIS state and not off the live game's. */
export function buildSetupFreeVerdictState(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(buildBladeBaseState(), spec);
}
