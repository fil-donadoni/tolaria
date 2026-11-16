// The canned run's answer to a discard pick (`scenarioGenerator.ts`,
// `analyseChoice`): shared by the catalogue smoke sweep and the generator's
// own unit tests, so both resolve a scenario the same way.

import { applyPendingChoiceSubmit } from "../../gre/pendingChoiceSubmit";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import type { Scenario } from "../../gre/effects/scenarioGenerator";

/** Resolves the top of the stack with the scenario's chooser answering: each
 *  time the resolution suspends on a pick the scenario answers
 *  (`scenario.choiceAnswers`), its picks go through the real submit path,
 *  which re-validates them and resumes the resolution (CR 608.2d). A choice
 *  it does not answer stays pending, and the assertions read that state. */
export function resolveAnsweringChoices(
    state: GameState,
    scenario: Scenario
): void {
    resolveTopOfStack(state);
    const answered = new Set<string>();
    for (;;) {
        const head = state.pendingChoices?.[0];
        if (head === undefined || answered.has(head.choiceId)) return;
        const answer = scenario.choiceAnswers?.[head.choiceId];
        if (answer === undefined) return;
        answered.add(head.choiceId);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [...answer.picks],
        });
    }
}
