// DFT — per-card behavior tests for multicolor cards in
// `convex/cards/sets/dft/multicolor.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { brightglassGearhulk } from "../multicolor";
import { ornithopter } from "../../atq/colorless";
import { registerTokenDefinition } from "../../..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

// Ornithopter is mana value 0 (an Artifact Creature) — a real registered
// mv-0 card covers the "artifact" branch. A synthetic mv-1 Enchantment and a
// synthetic mv-4 Enchantment cover the "enchantment" branch and the ceiling.
const CHEAP_ENCHANTMENT_ID = "test-dft-cheap-enchantment";
registerTokenDefinition({
    id: CHEAP_ENCHANTMENT_ID,
    name: "Test Cheap Enchantment",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Enchantment"],
});
const EXPENSIVE_ENCHANTMENT_ID = "test-dft-expensive-enchantment";
registerTokenDefinition({
    id: EXPENSIVE_ENCHANTMENT_ID,
    name: "Test Expensive Enchantment",
    rarity: "common",
    manaCost: { X: 4 },
    types: ["Enchantment"],
});

describe("Brightglass Gearhulk (CR 603.6a ETB / 701.19 / 400.7 / 701.20, issue #677)", () => {
    it("is a 4/4 first strike, trample artifact creature", () => {
        expect(brightglassGearhulk.power).toBe(4);
        expect(brightglassGearhulk.toughness).toBe(4);
        expect(brightglassGearhulk.staticAbilities).toEqual([
            "first strike",
            "trample",
        ]);
    });

    it("ETB: may search for up to two cheap artifact/creature/enchantment cards, put them into hand", () => {
        const hulk = makeInstance(brightglassGearhulk.id, {
            id: "hulk1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const orn = makeInstance(ornithopter.id, {
            id: "orn1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const cheapEnchant = makeInstance(CHEAP_ENCHANTMENT_ID, {
            id: "cheapEnchant1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const expensive = makeInstance(EXPENSIVE_ENCHANTMENT_ID, {
            id: "expensive1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [hulk],
                    library: [orn, cheapEnchant, expensive],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...hulk,
            id: "trig-hulk-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "brightglass-gearhulk-etb-search",
            triggerSourceId: "hulk1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "hulk1",
                controllerId: "p1",
                types: hulk.types,
            },
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.count).toEqual({ min: 0, max: 2 });
        // The Ornithopter (artifact, mv 0) and the cheap Enchantment (mv 1)
        // match; the mv-4 Enchantment fails the "mana value 1 or less"
        // ceiling.
        expect(head.candidateIds?.sort()).toEqual(["cheapEnchant1", "orn1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["orn1", "cheapEnchant1"],
        });
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "cheapEnchant1",
            "orn1",
        ]);
    });
});
