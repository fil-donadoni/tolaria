// Per-card test for tmp/red.ts — Mogg Fanatic. Same sacrifice-for-effect
// shape as nem Seal of Fire, but on a creature: the self-sacrifice cost
// (`cost.sacrifice: true`) is NOT a tap ability, so summoning sickness never
// gates it (CR 302.6 / 602.5b) — a Mogg Fanatic can ping the turn it enters.
// Exercised through the GRE entry point: pay the cost (move the source to the
// graveyard), then resolve the `dealDamage` off the stack-item clone.
import { describe, it, expect } from "vitest";
import { moggFanatic } from "..";
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
 *  the stack and resolve it. */
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

describe("Mogg Fanatic (sacrifice-for-effect, CR 602.1 / 701.21 / 120.1)", () => {
    it("sacrifices itself to deal 1 damage to a player and lands in the graveyard", () => {
        const mogg = makeInstance(moggFanatic.id, {
            id: "mogg",
            controllerId: "p1",
            ownerId: "p1",
            // Summoning-sick: proves a sacrifice ability is unaffected (it is
            // not a tap ability).
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "player", id: "p2" },
        ]);

        expect(getPlayer(state, "p2").life).toBe(19);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "mogg")
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "mogg")
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("can ping a 1-toughness creature to death (any target)", () => {
        const mogg = makeInstance(moggFanatic.id, { id: "mogg" });
        const foe = makeInstance(moggFanatic.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "permanent", id: "foe" },
        ]);

        // 1 damage to a 1/1 is lethal — the SBA sweep in resolveTopOfStack
        // moves it to the graveyard.
        expect(
            getPlayer(state, "p2").battlefield.some((c) => c.id === "foe")
        ).toBe(false);
        expect(
            getPlayer(state, "p2").graveyard.some((c) => c.id === "foe")
        ).toBe(true);
    });

    it("the damage and the sacrifice survive the public projection (wire format)", () => {
        const mogg = makeInstance(moggFanatic.id, {
            id: "mogg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "player", id: "p2" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(19);
        expect(
            projected.players[0].battlefield.some((c) => c.id === "mogg")
        ).toBe(false);
        expect(
            projected.players[0].graveyard.some((c) => c.id === "mogg")
        ).toBe(true);
    });
});
