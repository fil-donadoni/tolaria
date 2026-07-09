// Per-card behavior tests for DMU green cards (`convex/cards/sets/dmu/green.ts`).
// Tear Asunder exercises the Kicker capability (CR 702.33): the kick widens the
// target set (artifact/enchantment → any nonland permanent) via
// `kickedTargetRequirement`; here we assert the resolution exiles the target.

import { describe, it, expect } from "vitest";
import { tearAsunder } from "../green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { solRing, grizzlyBears } from "../../lea";
import { resolveTopOfStack, type StackItem } from "../../../../gre/state";

describe("Tear Asunder (Kicker {1}{B}, CR 702.33 / 701.13)", () => {
    it("exiles the targeted artifact on resolution", () => {
        const rock = makeInstance(solRing.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "rock",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        pushSpell(state, tearAsunder.id, "p1", [
            { type: "permanent", id: "rock" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "rock")
        ).toBeUndefined();
        expect(
            state.players[1].exile.find((c) => c.id === "rock")
        ).toBeDefined();
    });

    it("kicked exiles a creature (nonland permanent)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bear",
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item: StackItem = pushSpell(state, tearAsunder.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.kickerCount = 1;
        resolveTopOfStack(state);
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("declares artifact/enchantment unkicked and nonland-permanent kicked", () => {
        expect(tearAsunder.targetRequirement?.type).toEqual([
            "Artifact",
            "Enchantment",
        ]);
        expect(tearAsunder.kickedTargetRequirement?.type).toEqual([
            "Creature",
            "Artifact",
            "Enchantment",
            "Planeswalker",
        ]);
    });
});
