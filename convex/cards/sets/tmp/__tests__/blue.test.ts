// Per-card behavior tests for blue cards in `convex/cards/sets/tmp/blue.ts`
// (Tempest, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises. Shared stack/resolve
// shims live in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { timeWarp } from "../blue";
import { makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

// Time Warp — DSL card reusing the `extraTurn` Op (issue #686). The Op's own
// construct-level coverage (announced target / controller / wire survival)
// lives in `gre/effects/__tests__/interpreter.test.ts`; this suite is the
// per-card smoke test through the real card definition.
describe("Time Warp (extra turn after this one, CR 500.7, issue #686)", () => {
    it("is a {3}{U}{U} sorcery targeting a player", () => {
        expect(timeWarp.manaCost).toEqual({ X: 3, U: 2 });
        expect(timeWarp.types).toEqual(["Sorcery"]);
        expect(timeWarp.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("resolves by queueing an extra turn for the target player", () => {
        const state = makeState();
        pushSpell(state, timeWarp.id, "p1", [{ type: "player", id: "p2" }]);
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p2"]);
    });

    it("wire format: extraTurns survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, timeWarp.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p2"]);
    });
});
