// Cluster O — random-discard as an activation cost (CR 118.3 / 701.8, Coral
// Helm, #292). Integration test for the cost path that crosses GRE → game.ts →
// UI. The project has no convex-test harness (ADR 0001), so — like
// sacrifice-cost-activation.test.ts — the production mutation handler's
// `cost.discardAtRandom` branches (up-front empty-hand legality, the mana-
// covered immediate commit, and the commit-time discard) are mirrored here as
// pure functions that drive the REAL exported GRE state functions. A
// divergence (forgetting the discard, or activating with an empty hand) fails
// this test.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    getOpponentId,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    payDiscardAtRandomCost,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { getDefinition } from "../../cards";
import { coralHelm } from "../../cards/sets/atq";
import { grizzlyBears } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

/** Mirror of activateAbility's mana-covered immediate-commit path for an
 *  ability with `cost.discardAtRandom` and a target. Includes the up-front
 *  empty-hand legality check, then pays mana + random-discard at commit and
 *  resolves. */
function activateCoralHelm(
    state: GameState,
    playerId: string,
    sourceId: string,
    targetId: string
): void {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === sourceId);
    if (!card) throw new Error("Source not on battlefield");
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities!.find(
        (a) => a.id === "coral-helm-pump"
    )!;

    // CR 118.3 — illegal with an empty hand (validated up-front in game.ts).
    if (ability.cost.discardAtRandom && player.hand.length === 0) {
        throw new Error("No card in hand to discard");
    }

    const manaCost = normalizeManaCost(ability.cost.mana!);
    if (!isManaCostCovered(player.manaPool, manaCost)) {
        throw new Error("mana not covered");
    }

    // Commit (CR 602.1): pay mana, pay the random-discard cost, push, resolve.
    payManaCost(player.manaPool, manaCost);
    if (ability.cost.discardAtRandom) {
        payDiscardAtRandomCost(state, playerId, ability.cost.discardAtRandom);
    }
    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId: "coral-helm-pump",
        targets: [{ type: "permanent", id: targetId }],
    };
    state.stack.push(stackItem);
    state.priorityPlayerId = getOpponentId(state, playerId);
    resolveTopOfStack(state);
}

describe("Coral Helm random-discard cost (CR 118.3 / 701.8, #292)", () => {
    const setup = (handSize: number) => {
        const helm = makeInstance(coralHelm.id, {
            id: "helm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = Array.from({ length: handSize }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `h${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [helm, bear],
                    hand,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
            // Deterministic random discard.
            rngSeed: 7,
            rngCounter: 0,
        });
        return { state };
    };

    it("pays {3} + discards one card at random, then pumps the target +2/+2", () => {
        const { state } = setup(2);
        activateCoralHelm(state, "p1", "helm", "bear");
        const p1 = state.players[0];
        // One card discarded at random (cost), mana spent.
        expect(p1.hand.length).toBe(1);
        expect(p1.graveyard.length).toBe(1);
        expect(p1.manaPool.C).toBe(0);
        // The pump resolved.
        const bear = p1.battlefield.find((c) => c.id === "bear")!;
        expect(bear.temporaryPTMods).toEqual([
            { power: 2, toughness: 2, duration: { phase: "end-of-turn" } },
        ]);
    });

    it("is illegal to activate with an empty hand", () => {
        const { state } = setup(0);
        expect(() => activateCoralHelm(state, "p1", "helm", "bear")).toThrow(
            /hand/i
        );
    });
});
