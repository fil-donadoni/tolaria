// Per-card behavior tests for ZEN red cards (`convex/cards/sets/zen/red.ts`).
// Burst Lightning exercises the Kicker capability (CR 702.33) + the
// `kickerCount` value member: 2 damage, or 4 when kicked.

import { describe, it, expect } from "vitest";
import { burstLightning } from "../red";
import { makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack, type StackItem } from "../../../../gre/state";

describe("Burst Lightning (Kicker {4}, CR 702.33 / 120)", () => {
    it("deals 2 damage to any target when not kicked", () => {
        const state = makeState();
        pushSpell(state, burstLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("deals 4 damage instead when kicked", () => {
        const state = makeState();
        const item: StackItem = pushSpell(state, burstLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
    });
});
