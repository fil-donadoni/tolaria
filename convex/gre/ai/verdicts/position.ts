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

import type { GameState } from "../../state";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import type { Verdict } from "./types";

// `candidateMoves` and the position builder live in the PURE sibling (issue
// #3405) so the browser can call them without dragging this module — and
// therefore the blade harness and its registry — into the client bundle.
// Re-exported here, where every existing caller already imports them, so there
// is one name for each.
export { candidateMoves, buildSetupFreeVerdictState } from "./candidates";

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
