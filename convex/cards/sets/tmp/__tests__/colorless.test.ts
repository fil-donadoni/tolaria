// Tempest (TMP) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { ancientTomb, lotusPetal } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applyUnconditionalTapSelfDamage,
    tapSourceIntoPayment,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

// Ancient Tomb — "{T}: Add {C}{C}. This land deals 2 damage to you." The
// self-damage rides the NEW `dealsDamageToControllerOnTap` rider (issue
// #675) — the unconditional sibling of the painland
// `dealsDamageToControllerOnColoredTap` rider, firing on EVERY tap
// regardless of the (here, always colorless) mana produced.
describe("Ancient Tomb ({T}: Add {C}{C}, self-damage, CR 605.1a / 120)", () => {
    it("mana ability produces {C}{C} and declares the unconditional damage rider", () => {
        const ability = ancientTomb.activatedAbilities![0];
        expect(ability.manaProduced).toEqual({ C: 2 });
        expect(ability.dealsDamageToControllerOnTap).toBe(2);
    });

    it("tapping for mana deals 2 damage to the controller", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const ability = ancientTomb.activatedAbilities![0];
        applyUnconditionalTapSelfDamage(state, ability, tomb, "p1");
        expect(state.players[0].life).toBe(18);
    });

    it("does not fire when the ability lacks the rider", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb], life: 20 }),
                makePlayer("p2"),
            ],
        });
        applyUnconditionalTapSelfDamage(
            state,
            {
                ...ancientTomb.activatedAbilities![0],
                dealsDamageToControllerOnTap: undefined,
            },
            tomb,
            "p1"
        );
        expect(state.players[0].life).toBe(20);
    });

    // Full path through the real tap-for-mana entry point (mirrors the ICE
    // painland harness, `tapSourceIntoPayment` — the same exported game.ts
    // function the painland cycle uses directly in unit tests). This is the
    // FIRST card exercising `dealsDamageToControllerOnTap`: verifies the mana
    // and the damage land TOGETHER from one activation, not the rider in
    // isolation.
    it("activating the mana ability adds {C}{C} to the pool AND deals 2 damage to the controller (CR 605.1a / 120)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        expect(player.manaPool.C).toBe(2);
        expect(player.life).toBe(18);
        expect(tomb.isTapped).toBe(true);
    });

    it("the self-damage fires exactly once per tap (not doubled, not on untap)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        // One tap → exactly one 2-damage ping, never a double-fire from both
        // the choice and fixed branches (Ancient Tomb has no manaChoices, so
        // only the fixed branch of tapSourceIntoPayment runs).
        expect(player.life).toBe(18);
        expect(player.manaPool.C).toBe(2);
    });

    it("the mana and the life loss both survive the wire-format projection (PublicGameState)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(18);
        expect(projected.players[0].manaPool.C).toBe(2);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tomb"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});

// Lotus Petal — "{T}, Sacrifice this artifact: Add one mana of any color."
describe("Lotus Petal ({T}, Sacrifice: any color, CR 605.1a / 701.16)", () => {
    it("is a {0} artifact with a sacrifice-gated any-color mana ability", () => {
        expect(lotusPetal.manaCost).toEqual({});
        expect(lotusPetal.types).toEqual(["Artifact"]);
        const ability = lotusPetal.activatedAbilities![0];
        expect(ability.cost).toEqual({ tap: true, sacrifice: true });
        expect(ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("activating for {U} (index 1) sacrifices the petal and adds {U} (CR 701.16)", () => {
        const petal = makeInstance(lotusPetal.id, {
            id: "petal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [petal] });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, petal, 1, []);
        expect(player.manaPool.U).toBe(1);
        // Sacrifice cost: moved off the battlefield into the graveyard, not
        // left tapped.
        expect(
            player.battlefield.find((c) => c.id === "petal")
        ).toBeUndefined();
        expect(player.graveyard.find((c) => c.id === "petal")).toBeDefined();
    });
});
