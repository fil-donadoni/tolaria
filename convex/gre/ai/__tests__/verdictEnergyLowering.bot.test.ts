// CR 107.14 — a Bot decision on a "pay any amount of {E}" choice lowers into a
// scenario spec that carries the live energy counters, so the rebuilt position
// offers every payable amount instead of only "pay 0" (which the quiz refuses
// as `single-candidate`).
//
// The live position is reached through the real engine: a blade-built board,
// the Bot's Galvanic Discharge cast through the setup vocabulary, and
// `resolve-top` through `resolveTopOfStack` — step 0 grants {E}{E}{E}, step 1
// suspends on the pay choice.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import { describeMove } from "../../describeMove";
import type { GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

const BOARD: ScenarioSpec = {
    cards: [
        { name: "Galvanic Discharge", owner: "me", zone: "hand" },
        { name: "Mountain", owner: "me" },
        { name: "Hill Giant", owner: "opp" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
};

function payChoicePending(): { state: GameState; botId: string } {
    const state = buildBladeState({
        label: "energy pay-choice lowering fixture",
        spec: BOARD,
        setup: [
            {
                kind: "cast",
                card: "Galvanic Discharge",
                by: "me",
                target: "Hill Giant",
            },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    return { state, botId: state.players[0].id };
}

describe("an energy-payment decision lowers with the live energy (CR 107.14)", () => {
    it("rebuilds the Discharge pay choice with every payable amount, not a single-candidate refusal", () => {
        const { state, botId } = payChoicePending();
        expect(state.players[0].energyCounters).toBe(3);
        expect(state.pendingChoices?.[0].playerId).toBe(botId);
        const live = candidateMoves(state, botId);
        expect(live.length).toBeGreaterThanOrEqual(2);

        const outcome = lowerDecision(
            state,
            botId,
            describeMove(live[0], state)
        );
        if (!outcome.ok) {
            throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
        }
        expect(outcome.lowered.spec.energy).toEqual({ me: 3 });
        expect(outcome.lowered.candidates.length).toBeGreaterThanOrEqual(2);
        expect(
            outcome.lowered.dropped.some((note) =>
                note.includes("energyCounters")
            )
        ).toBe(false);

        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        expect(rebuilt.players[0].energyCounters).toBe(3);
    });
});
