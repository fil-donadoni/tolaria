// Per-card behavior tests for ZNR black cards (`convex/cards/sets/znr/black.ts`).
// Bloodchief's Thirst exercises the Kicker capability (CR 702.33): the kick
// widens the target set (MV ≤ 2 → any) via `kickedTargetRequirement`, proven in
// convex/gre/__tests__/kicker.test.ts; here we assert the resolution destroys
// the chosen target.

import { describe, it, expect } from "vitest";
import { bloodchiefsThirst } from "../black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { serraAngel } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";

describe("Bloodchief's Thirst (Kicker {2}{B}, CR 702.33)", () => {
    it("destroys the targeted creature on resolution", () => {
        const angel = makeInstance(serraAngel.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "angel",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, bloodchiefsThirst.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "angel")
        ).toBeUndefined();
    });
});
