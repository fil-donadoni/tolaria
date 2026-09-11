// Rebuilding the position a Verdict names, and the candidate set it is judged
// over (issue #3400).
//
// A Verdict stores a `ScenarioSpec` and the engine-real `setup` steps, never a
// `GameState` and never a `Move`: instance ids are an artefact of how a state
// was built, so a stored move would rot the first time the builder allocated
// differently, and a stored state would be a position the engine might no
// longer be able to produce (ADR 0070 §4). Both the registry lowering and the
// Eval Pair bridge therefore go through the SAME two functions here — the
// production blade builder and the production enumerator — so "the candidates
// a verdict names" and "the candidates the Bot has" cannot drift apart.

import { enumerateMoves, type Move } from "../../moves";
import type { GameState } from "../../state";
import { beginDominanceDecision, endDominanceDecision } from "../dominance";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import type { Verdict } from "./types";

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

/** The verdict's position as a blade scenario, so it is built by the same
 *  `buildBladeState` a blade entry is. `budget` / `tier` / `expect` are
 *  structurally required and unread by the builder; they are filled with the
 *  cheapest well-formed values rather than faked into meaning something. */
export function scenarioOfVerdict(verdict: Verdict): BladeScenario {
    return {
        label: verdict.id,
        spec: verdict.spec,
        ...(verdict.setup ? { setup: verdict.setup } : {}),
        bot: verdict.seat,
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    };
}

/** Build the verdict's position. Throws exactly what the blade builder throws
 *  (`BladeSetupError` for a setup step that finds no purchase) — a position
 *  that cannot be rebuilt is a finding about the verdict, not something to
 *  approximate. */
export function buildVerdictState(verdict: Verdict): GameState {
    return buildBladeState(scenarioOfVerdict(verdict));
}
