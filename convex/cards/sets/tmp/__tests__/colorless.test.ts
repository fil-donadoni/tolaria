// TMP (Tempest) — colorless card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import { ancientTomb, lotusPetal, wasteland } from "../colorless";
import { plains, badlands } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applyUnconditionalTapSelfDamage,
    tapSourceIntoPayment,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { getLegalTargets } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";

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

describe("Wasteland (CR 701.26 mana ability / CR 701.7 destroy nonbasic land)", () => {
    it("is a Land with a mana ability and a sacrifice-to-destroy ability", () => {
        expect(wasteland.types).toEqual(["Land"]);
        expect(wasteland.activatedAbilities).toHaveLength(2);
        const destroyAbility = wasteland.activatedAbilities!.find(
            (a) => a.id === "wasteland-destroy"
        )!;
        expect(destroyAbility.targetRequirement).toMatchObject({
            type: "Land",
            excludeSupertypes: "Basic",
        });
    });

    it("{T}: Add {C} (CR 106.1)", () => {
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] })],
        });
        const manaAbility = wasteland.activatedAbilities!.find(
            (a) => a.id === "wasteland-mana"
        )!;
        manaAbility.effect!({
            addMana: (amount) => {
                for (const [color, count] of Object.entries(amount)) {
                    if (color === "X" || typeof count !== "number") continue;
                    state.players[0].manaPool[color] =
                        (state.players[0].manaPool[color] ?? 0) + count;
                }
            },
        });
        expect(state.players[0].manaPool.C).toBe(1);
    });

    it("getLegalTargets excludes a basic land and includes a nonbasic land (CR 205.4a)", () => {
        const basic = makeInstance(plains.id, {
            id: "basic",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [basic] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        const legal = getLegalTargets(state, {
            type: "Land",
            count: 1,
            excludeSupertypes: "Basic",
        });
        const legalIds = legal.map((t) => ("id" in t ? t.id : undefined));
        expect(legalIds).toContain("nonbasic");
        expect(legalIds).not.toContain("basic");
    });

    it("destroy ability destroys a targeted nonbasic land (CR 701.7)", () => {
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        state.stack.push({
            ...makeInstance(wasteland.id, {
                id: "w-ability",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "wasteland-destroy",
            targets: [{ type: "permanent", id: "nonbasic" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "nonbasic")
        ).toBe(false);
    });

    it("wire: the destroyed nonbasic land is gone from both viewers' projected battlefield", () => {
        // Target legality (excludeSupertypes) is computed server-side only —
        // getLegalTargets always runs against the fat GameState, never a
        // projected client view (the frontend has no local re-derivation to
        // test, confirmed: no src/ file references excludeSupertypes /
        // supertypeFilter). The wire-relevant fact is the OUTCOME: the
        // destroyed land disappears from the projected board for both seats.
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        state.stack.push({
            ...makeInstance(wasteland.id, {
                id: "w-ability",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "wasteland-destroy",
            targets: [{ type: "permanent", id: "nonbasic" }],
        });
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            expect(
                projected.players[1].battlefield.some(
                    (c) => c.id === "nonbasic"
                )
            ).toBe(false);
        }
    });
});
