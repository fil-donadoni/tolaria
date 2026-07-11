// Cycling (CR 702.29) — the engine/cost capability shared by every cycling
// card (issue #689). Built once here, reused by all the per-card tests
// (iko/snc Triomes, Miscalculation, Unearth, Marauding Mako).
//
// CR 702.29a: "Cycling [cost]" means "[cost], Discard this card: Draw a card."
//   This activated ability functions only while this card is in your hand.
// CR 702.29b: A card may be cycled any time its owner could cast an instant.
//
// The project has no convex-test harness (ADR 0001), so this drives the REAL
// exported cost-commit primitives (`buildPendingActivation` +
// `tryAutoCommitPendingActivation` from game.ts — the same functions the
// `activateAbility` mutation calls) and the REAL `resolveTopOfStack`. A
// regression in the hand-zone locator, the discard-this cost, or the draw
// resolution fails here.

import { describe, it, expect } from "vitest";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../game";
import { normalizeManaCost, resolveTopOfStack, type GameState } from "../state";
import { getDefinition } from "../../cards";
import { raugrinTriome } from "../../cards/sets/iko/colorless";
import { grizzlyBears } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const CYCLING_ID = "cycling";

/** The Cycling ability declared on a card definition. */
function cyclingAbilityOf(cardId: string) {
    const ability = getDefinition(cardId).activatedAbilities?.find(
        (a) => a.id === CYCLING_ID
    );
    if (!ability) throw new Error("card has no cycling ability");
    return ability;
}

/** Replicates the `activateAbility` mutation's Cycling path over real GRE
 *  primitives: build the pendingActivation descriptor for a hand source with a
 *  discard-this cost, then auto-commit (mana already in pool). Returns the
 *  commit result (null if nothing committed). */
function cycleFromHand(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    cardId: string
) {
    const ability = cyclingAbilityOf(cardId);
    state.pendingActivation = buildPendingActivation({
        playerId,
        cardInstanceId,
        abilityId: CYCLING_ID,
        ability,
        // The real `activateAbility` mutation normalizes the printed cost via
        // `resolveAbilityManaCost` before deferring it; mirror that here so
        // `{ generic: N }` folds into the generic total the solver reads.
        manaCost: ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : undefined,
        fromHand: true,
    });
    return tryAutoCommitPendingActivation(state, playerId);
}

describe("cycling (CR 702.29)", () => {
    it("the ability is usable from hand at instant speed (no phase restriction)", () => {
        const ability = cyclingAbilityOf(raugrinTriome.id);
        expect(ability.activateFromHand).toBe(true);
        expect(ability.cost.discardThis).toBe(true);
        expect(ability.useStack).toBe(true);
        // CR 702.29b — instant speed: no phase gate.
        expect(ability.activationPhaseRestriction).toBeUndefined();
        // The effect is a plain draw Op (the cost is the cycling-specific part).
        expect(ability.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("pays the cost, discards this card, and draws a card", () => {
        const triome = makeInstance(raugrinTriome.id, {
            id: "triome-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const topOfLibrary = makeInstance(grizzlyBears.id, {
            id: "lib-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [triome],
                    library: [topOfLibrary],
                    // {3} already floating so the commit fires immediately.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
        });

        const result = cycleFromHand(state, "p1", "triome-1", raugrinTriome.id);
        expect(result).not.toBeNull();

        const p1 = state.players[0];
        // CR 702.29a — the card left the hand to the graveyard as a cost.
        expect(p1.hand.some((c) => c.id === "triome-1")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "triome-1")).toBe(true);
        // The {3} cost was paid from the pool.
        expect(p1.manaPool.C).toBe(0);
        // CR 701.8 — the discard routes through the shared choke point and
        // emits CARD_DISCARDED (consumed by the trigger scan at commit — see the
        // Marauding Mako test, which asserts the resulting counter). The cycling
        // uses the stack; it can be responded to).
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].abilityId).toBe(CYCLING_ID);
        // The card is NOT yet drawn (draw happens on resolution).
        expect(p1.hand.some((c) => c.id === "lib-1")).toBe(false);

        // CR 702.29a — resolve "Draw a card".
        resolveTopOfStack(state);
        expect(state.stack.length).toBe(0);
        expect(p1.hand.some((c) => c.id === "lib-1")).toBe(true);
        expect(p1.library.length).toBe(0);
    });

    it("defers the discard until commit — an uncovered cost leaves the card in hand", () => {
        const triome = makeInstance(raugrinTriome.id, {
            id: "triome-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [triome],
                    // No mana — the cost is uncovered, so commit does not fire.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        const result = cycleFromHand(state, "p1", "triome-2", raugrinTriome.id);
        // CR 118 — deferred payment: nothing committed while mana is unpaid.
        expect(result).toBeNull();
        const p1 = state.players[0];
        // The card is still in hand (the discard is deferred to commit).
        expect(p1.hand.some((c) => c.id === "triome-2")).toBe(true);
        expect(p1.graveyard.length).toBe(0);
        expect(state.stack.length).toBe(0);
    });
});
