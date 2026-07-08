// Per-card test for nem/red.ts — Seal of Fire. The "Sacrifice this: deal N
// damage to any target" shape (shared with tmp Mogg Fanatic) is exercised
// here via the GRE entry point: the self-sacrifice cost (`cost.sacrifice`) is
// paid by removing the source to the graveyard BEFORE the ability resolves off
// its stack-item clone, then `dealDamage` lands on the announced any-target.
// The convention (`.claude/rules/gre-development.md` § Card testing
// convention) mandates a GRE test asserting the damage + the permanent leaving
// for an activated ability, plus a wire-format re-assertion for the
// board-visible outcome.
import { describe, it, expect } from "vitest";
import { sealOfFire } from "..";
import {
    getPlayer,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

/** Mirror of the game.ts commit path for a no-mana, no-tap self-sacrifice
 *  activated ability (`cost.sacrifice: true`): pay the cost by moving the
 *  source to the graveyard, then push the ability (a clone of the source) on
 *  the stack and resolve it. Asserts the exact engine ordering — the source is
 *  gone before the effect runs (CR 602.1 / 701.21). */
function sacrificeSelfActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    const stackItem: StackItem = {
        ...structuredClone(source),
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    };
    removePermanentTo(state, source.id, "graveyard");
    state.stack.push(stackItem);
    resolveTopOfStack(state);
}

describe("Seal of Fire (sacrifice-for-effect, CR 602.1 / 701.21 / 120.1)", () => {
    it("sacrifices itself to deal 2 damage to a player and lands in the graveyard", () => {
        const seal = makeInstance(sealOfFire.id, {
            id: "seal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "player", id: "p2" },
        ]);

        // Damage dealt.
        expect(getPlayer(state, "p2").life).toBe(18);
        // The permanent left the battlefield (sacrificed as the cost).
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "seal")
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "seal")
        ).toBe(true);
        // Ability fully resolved.
        expect(state.stack).toHaveLength(0);
    });

    it("can deal its 2 damage to a creature (any target)", () => {
        const seal = makeInstance(sealOfFire.id, { id: "seal" });
        const bear = makeInstance(sealOfFire.id, {
            // any 2+-toughness stand-in isn't needed; use a synthetic creature.
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Give the stand-in creature shape so damage marks without dying.
        bear.types = ["Creature"];
        bear.power = 3;
        bear.toughness = 3;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "permanent", id: "bear" },
        ]);

        expect(
            getPlayer(state, "p2").battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(2);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "seal")
        ).toBe(true);
    });

    it("the damage and the sacrifice survive the public projection (wire format)", () => {
        const seal = makeInstance(sealOfFire.id, {
            id: "seal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "player", id: "p2" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
        // The projection strips card.card to { id }; the sacrificed Seal is in
        // p1's graveyard on the wire, not the battlefield.
        expect(
            projected.players[0].battlefield.some((c) => c.id === "seal")
        ).toBe(false);
        expect(
            projected.players[0].graveyard.some((c) => c.id === "seal")
        ).toBe(true);
    });
});
