/**
 * The Brain's energy model (issue #9694): the `energy` evaluation term.
 *
 * CR references: 107.14 (the energy symbol; paying {E} removes an energy
 * counter from the player).
 *
 * Before the term the evaluator never read `energyCounters`, so paying two
 * energy and paying three into the same 2/2 (Galvanic Discharge) scored the
 * same world and the pick fell to rollout noise.
 */

import { describe, it, expect } from "vitest";
import { evaluate, evaluateBreakdown } from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import type { GameState } from "../state";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";

const ME = "p1";
const OPP = "p2";

function board(energy: { me?: number; opp?: number }): GameState {
    return makeState({
        players: [
            makePlayer(ME, { energyCounters: energy.me }),
            makePlayer(OPP, { energyCounters: energy.opp }),
        ],
        activePlayerId: ME,
    });
}

describe("the energy term (CR 107.14)", () => {
    it("scores a held energy counter above the same position without it", () => {
        expect(evaluate(board({ me: 3 }), ME)).toBeGreaterThan(
            evaluate(board({ me: 2 }), ME)
        );
    });

    it("prices each counter at `energyWeight`, linear", () => {
        const at = (n: number) =>
            evaluateBreakdown(board({ me: n }), ME).self.energy;
        expect(at(0)).toBe(0);
        expect(at(1)).toBeCloseTo(DEFAULT_EVAL_WEIGHTS.energyWeight);
        expect(at(3) - at(2)).toBeCloseTo(at(1) - at(0));
    });

    it("reads the opponent's energy as the mover's loss", () => {
        expect(evaluate(board({ opp: 3 }), ME)).toBeLessThan(
            evaluate(board({}), ME)
        );
    });
});
