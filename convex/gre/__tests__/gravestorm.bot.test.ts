// Gravestorm's tally (CR 702.69a) through the debug scenario spec: the position
// builder is a bot-only module, so this round trip lives in the bot suite.

import { describe, expect, it } from "vitest";
import { makeState } from "../../cards/__tests__/setup.helper";
import { buildPositionFromSpec } from "../ai/blade/build";
import { specFromState } from "../scenarioBuilder";

describe("Gravestorm's tally in the scenario spec (CR 702.69a)", () => {
    it("round-trips through the debug scenario spec", () => {
        const state = makeState();
        state.permanentsToGraveyardThisTurn = 2;
        const { spec } = specFromState(state, { mySeatId: "p1" });
        expect(spec.permanentsToGraveyardThisTurn).toBe(2);
        const rebuilt = buildPositionFromSpec(spec);
        expect(rebuilt.permanentsToGraveyardThisTurn).toBe(2);
    });
});
