// Per-card behaviour tests for black cards in `convex/cards/sets/dsk/black.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.
//
// Enduring Tenacity (issue #2085) is the catalogue's FIRST `LIFE_GAINED`
// trigger AND a `resolve()` body, so the per-Op regime covers none of it: what
// is tested here is the trigger's own gate (CR 109.5 — "YOU gain life", not
// "a player"), the CR 603.3d announced target, and that the drain is the
// amount actually gained off the event. The cycle's shared dies-trigger is
// covered once on Enduring Innocence (`white.test.ts`).

import { describe, it, expect } from "vitest";
import { enduringTenacity } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applySourceStaticEffects,
    gainLifeEmitting,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import type { GameState } from "../../../../gre/state";

/** p1 controls Enduring Tenacity; p2 is the sole opponent, so the CR 603.3d
 *  "target opponent" slot has exactly one legal choice and auto-locks. */
function board(): GameState {
    const tenacity = makeInstance(enduringTenacity.id, {
        id: "tenacity",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [tenacity], life: 20 }),
            makePlayer("p2", { life: 20 }),
        ],
    });
    applySourceStaticEffects(state, tenacity);
    return state;
}

/** Runs the whole path a real lifegain takes: the `gainLifeEmitting` choke
 *  point (CR 119.3) emits LIFE_GAINED, the trigger scan puts the ability on
 *  the stack, its sole legal target locks (CR 603.3d), and it resolves. */
function gainAndResolve(state: GameState, playerId: string, amount: number) {
    gainLifeEmitting(state, playerId, amount);
    processPendingActionTriggers(state);
    raiseTriggerTargetSelection(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
}

describe("Enduring Tenacity — whenever you gain life, target opponent loses that much (CR 119.3 / 603.3d, issue #2085)", () => {
    it("drains the opponent for exactly the amount gained", () => {
        const state = board();

        gainAndResolve(state, "p1", 3);

        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(17);
    });

    it("the drain follows the amount, not a fixed number", () => {
        const state = board();

        gainAndResolve(state, "p1", 7);

        expect(state.players[1].life).toBe(13);
    });

    it("does NOT fire on the opponent's lifegain — 'you' is the ability's controller (CR 109.5)", () => {
        const state = board();

        gainAndResolve(state, "p2", 5);

        expect(state.players[1].life).toBe(25);
        // p1 is untouched: the trigger never went on the stack at all.
        expect(state.players[0].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("two lifegains in flight each drain their OWN amount (CR 603.10 per-trigger snapshot)", () => {
        const state = board();

        // Both trigger before either resolves, so the second cannot be reading
        // the first's amount: each StackItem carries its own firing event.
        gainLifeEmitting(state, "p1", 2);
        gainLifeEmitting(state, "p1", 5);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(2);
        raiseTriggerTargetSelection(state);
        while (state.stack.length > 0) {
            resolveTopOfStack(state);
            raiseTriggerTargetSelection(state);
        }

        expect(state.players[0].life).toBe(27);
        expect(state.players[1].life).toBe(13);
    });

    it("announces its target on reaching the stack, before it resolves (CR 603.3d)", () => {
        const state = board();

        gainLifeEmitting(state, "p1", 2);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        // A sole mandatory target auto-selects: no PendingTarget is raised and
        // the engine locks the slot to the only opponent.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
        // Still un-resolved — the drain has not happened yet.
        expect(state.players[1].life).toBe(20);

        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });
});
