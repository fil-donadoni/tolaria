// Building the `GameState` a blade scenario describes — the board, then its
// engine-real `setup` steps (issue #1487, ADR 0070 §4).
//
// It is its own module, split out of `runner.ts` by issue #3479, for ONE
// reason: the browser needs it. `runner.ts` reaches the blade REGISTRY (6.6k
// lines of scenario data) and the whole harness; a caller that only wants to
// rebuild a position should not drag either into the client bundle. Nothing
// here is blade-specific beyond the `label` a failing step is reported under.
//
// This is the SINGLE builder. `buildBladeState` (the harness) and
// `buildSetupFreeVerdictState` (the verdict quiz, in the browser) are both
// calls into it, so the position a verdict is judged on and the position the
// blade suite measures cannot be built two different ways — which matters
// because instance ids are allocated BY the build, and a verdict keys its
// candidates off them (`verdicts/lowering.ts`).

import { buildStateFromScenario } from "../../scenarioBuilder";
import type { GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { buildBladeBaseState } from "./baseState";
import { applyBladeSetup } from "./setup";
import type { BladeScenario, BladeSetupStep } from "./types";

/** Build the position a `spec` plus its engine-real `setup` steps names.
 *  Throws `BladeSetupError` when a step finds no purchase in the engine —
 *  a position that cannot be reached is an authoring failure, never something
 *  to approximate (ADR 0070 §4). `label` only names the scenario in that
 *  error. */
export function buildPositionFromSpec(
    spec: ScenarioSpec,
    setup?: BladeSetupStep[],
    label = "position"
): GameState {
    return applyBladeSetup(
        buildStateFromScenario(buildBladeBaseState(), spec),
        { label, ...(setup ? { setup } : {}) }
    );
}

/** Build the `GameState` a blade entry describes. Exported so a failing entry
 *  can be inspected (or replayed at a bigger budget) from a scratch test. */
export function buildBladeState(scenario: BladeScenario): GameState {
    return buildPositionFromSpec(scenario.spec, scenario.setup, scenario.label);
}
