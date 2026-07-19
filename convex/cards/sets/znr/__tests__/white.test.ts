// ZNR — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { luminarchAspirant } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Luminarch Aspirant — {1}{W} Creature — Human Cleric, 1/1 (CR 603.6a
// combat-begin trigger; CR 122 counter placement). "At the beginning of
// combat on your turn, put a +1/+1 counter on target creature you control."
describe("Luminarch Aspirant (CR 603.6a beginning-of-combat trigger; CR 122 counter)", () => {
    function setup(extraCreatures: string[] = []) {
        const aspirant = makeInstance(luminarchAspirant.id, {
            id: "aspirant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const others = extraCreatures.map((id) =>
            makeInstance(luminarchAspirant.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aspirant, ...others] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        return { state, aspirant };
    }

    /** Pushes the beginning-of-combat trigger onto the stack (CR 603.6a) and
     *  returns the on-stack trigger item. `collectTriggers` sets its
     *  `controllerId` and `triggerSourceId` (`buildTriggerItem`). */
    function pushCombatTrigger(state: ReturnType<typeof setup>["state"]) {
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        return state.stack[state.stack.length - 1];
    }

    it("shape: 1/1 for {1}{W} with the beginning-of-combat trigger declared", () => {
        expect(luminarchAspirant.manaCost).toEqual({ X: 1, W: 1 });
        expect(luminarchAspirant.power).toBe(1);
        expect(luminarchAspirant.toughness).toBe(1);
        expect(luminarchAspirant.triggeredAbilities).toHaveLength(1);
    });

    it("declares the CR 603.3d target requirement: one creature you control", () => {
        expect(
            luminarchAspirant.triggeredAbilities?.[0]?.targetRequirement
        ).toEqual({ type: "Creature", count: 1, controller: "you" });
    });

    it("auto-selects the sole legal target (CR 603.3d) and puts a +1/+1 counter on it", () => {
        const { state } = setup();
        const trig = pushCombatTrigger(state);
        // Single mandatory legal target — no real choice, the engine locks it
        // at stack placement (raiseTriggerTargetSelection returns false, no
        // PendingTarget raised) then resolveTopOfStack applies the counter.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "aspirant" }]);
        expect(state.pendingTarget).toBeUndefined();
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
    });

    it("raises a trigger PendingTarget when 2+ creatures are legal, then applies the counter to the chosen one (CR 603.3d)", () => {
        const { state } = setup(["ally"]);
        pushCombatTrigger(state);
        // Two legal targets — a real choice is owed: the engine raises a
        // kind:"trigger" PendingTarget pointed at the on-stack trigger.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "ally" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        const ally = state.players[0].battlefield.find((c) => c.id === "ally")!;
        const aspirant = state.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(ally.counters?.["+1/+1"]).toBe(1);
        expect(aspirant.counters?.["+1/+1"]).toBeUndefined();
    });

    it("does NOT fire on the opponent's combat step (CR 603.6a scope: your)", () => {
        const { state } = setup();
        state.players.push(makePlayer("p2"));
        state.activePlayerId = "p2";
        const triggers = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p2",
            },
        ]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "luminarch-aspirant-counter"
            )
        ).toBe(false);
    });

    it("does nothing when there is no creature you control to target (CR 608.2b)", () => {
        const aspirant = makeInstance(luminarchAspirant.id, {
            id: "aspirant",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [aspirant] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        // No battlefield creature — collectTriggers finds nothing to scan
        // (the source itself is not on the battlefield here).
        const triggers = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p1",
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("wire format: the +1/+1 counter survives projectPublicState", () => {
        const { state } = setup();
        const trig = pushCombatTrigger(state);
        // Sole legal target auto-locks (CR 603.3d), then resolve.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "aspirant" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(getEffectivePower(projected, live)).toBe(2);
    });
});
