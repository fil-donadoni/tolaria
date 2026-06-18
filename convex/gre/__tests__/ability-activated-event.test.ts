// Cluster B — "ability activated" trigger event (issue #285).
// CR 602.1 / 603.2 / 603.3.
//
// Integration test for the activation-commit path that crosses
// GRE → game.ts → UI. The project has no convex-test harness (ADR 0001 /
// moves-integration.test.ts), so the production `activateAbility` commit step
// is mirrored here as a pure function that drives the REAL exported GRE
// functions — including `emitAbilityActivated` and `processPendingActionTriggers`
// in the same order and with the same `!ability.cost.tap` gate the mutation
// uses (game.ts `recordActivation`). A divergence (forgetting the emit, gating
// on the wrong flag, or skipping the trigger flush) fails this test.
//
// The end-to-end assertion: with Haunting Wind in play, activating an
// artifact's NON-{T} ability deals 1 damage to the artifact's controller via a
// freshly-collected ABILITY_ACTIVATED trigger; activating a {T} ability emits
// NO ABILITY_ACTIVATED event (it's the PERMANENT_TAPPED half instead).

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    getOpponentId,
    emitAbilityActivated,
    processPendingActionTriggers,
    resolveTopOfStack,
    payRemoveCounterCost,
    type GameState,
    type StackItem,
} from "../state";
import { getCardById } from "../../cards";
import { hauntingWind, triskelion, feldonsCane } from "../../cards/sets/atq";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

/** Mirrors game.ts `activateAbility` immediate-commit branch for a stack
 *  ability: pay the non-mana cost (tap / removeCounter), push the ability on
 *  the stack, then `recordActivation` (which emits ABILITY_ACTIVATED for
 *  non-{T} abilities) followed by the CR 603.3 trigger flush. Returns the
 *  pushed stack item id. */
function activateStackAbility(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");
    const def = getCardById((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability || !ability.useStack) throw new Error("Not a stack ability");

    if (ability.cost.tap) card.isTapped = true;
    if (ability.cost.removeCounter) {
        payRemoveCounterCost(card, ability.cost.removeCounter);
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId,
        targets,
    };
    state.stack.push(stackItem);

    // Mirror game.ts recordActivation: emit ABILITY_ACTIVATED only for non-{T}
    // abilities (the PERMANENT_TAPPED half covers {T} abilities).
    if (!ability.cost.tap) {
        emitAbilityActivated(state, card, abilityId);
    }
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    // CR 603.3 — flush so the punisher lands on top of the pushed ability.
    processPendingActionTriggers(state);
}

function setup() {
    // p1 (Haunting Wind controller) vs p2 (artifact controller).
    const hw = makeInstance(hauntingWind.id, {
        id: "hw",
        controllerId: "p1",
        ownerId: "p1",
    });
    const trisk = makeInstance(triskelion.id, {
        id: "trisk",
        controllerId: "p2",
        ownerId: "p2",
        counters: { "+1/+1": 3 },
    });
    const cane = makeInstance(feldonsCane.id, {
        id: "cane",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", { battlefield: [hw], life: 20 }),
            makePlayer("p2", {
                battlefield: [trisk, cane],
                life: 20,
                library: [],
            }),
        ],
    });
    return { state };
}

describe("ABILITY_ACTIVATED event end-to-end (Haunting Wind, issue #285)", () => {
    it("non-{T} ability of an artifact → emits event → Haunting Wind deals 1", () => {
        const { state } = setup();
        // Triskelion's "Remove a +1/+1 counter: deal 1 damage" — no {T} cost.
        activateStackAbility(state, "p2", "trisk", "triskelion-bolt", [
            { type: "player", id: "p1" },
        ]);
        // Haunting Wind's ABILITY_ACTIVATED trigger is now on top of the stack.
        const punisher = state.stack.find(
            (s) => s.triggeredAbilityId === "haunting-wind-ability"
        );
        expect(punisher).toBeDefined();
        // Resolve the punisher: 1 damage to the artifact's controller (p2).
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("{T} ability of an artifact → NO ABILITY_ACTIVATED event (tapped half)", () => {
        const { state } = setup();
        // Feldon's Cane "{T}, Exile this artifact: shuffle gy into library" —
        // a {T} ability. It must NOT emit ABILITY_ACTIVATED (the tap is the
        // PERMANENT_TAPPED half, handled separately).
        activateStackAbility(state, "p2", "cane", "feldons-cane-shuffle");
        expect(state.pendingEvents ?? []).toHaveLength(0);
        const punisher = state.stack.find(
            (s) => s.triggeredAbilityId === "haunting-wind-ability"
        );
        expect(punisher).toBeUndefined();
        // No life loss from Haunting Wind's ability half.
        expect(state.players[1].life).toBe(20);
    });
});
