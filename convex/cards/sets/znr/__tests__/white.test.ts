// ZNR — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { luminarchAspirant } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Luminarch Aspirant — {1}{W} Creature — Human Cleric, 1/1 (CR 603.6a
// combat-begin trigger; CR 122 counter placement). "At the beginning of
// combat on your turn, put a +1/+1 counter on target creature you control."
describe("Luminarch Aspirant (CR 603.6a beginning-of-combat trigger; CR 122 counter)", () => {
    function setup() {
        const aspirant = makeInstance(luminarchAspirant.id, {
            id: "aspirant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aspirant] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        return { state, aspirant };
    }

    it("shape: 1/1 for {1}{W} with the beginning-of-combat trigger declared", () => {
        expect(luminarchAspirant.manaCost).toEqual({ X: 1, W: 1 });
        expect(luminarchAspirant.power).toBe(1);
        expect(luminarchAspirant.toughness).toBe(1);
        expect(luminarchAspirant.triggeredAbilities).toHaveLength(1);
    });

    it("puts a +1/+1 counter on the (only) creature you control at the beginning of your combat", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                { type: "PHASE_BEGIN", phase: "BEGINNING_OF_COMBAT", activePlayerId: "p1" },
            ])
        );
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "aspirant")!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
    });

    it("does NOT fire on the opponent's combat step (CR 603.6a scope: your)", () => {
        const { state } = setup();
        state.activePlayerId = "p2";
        const triggers = collectTriggers(state, [
            { type: "PHASE_BEGIN", phase: "BEGINNING_OF_COMBAT", activePlayerId: "p2" },
        ]);
        expect(
            triggers.some((t) => t.triggeredAbilityId === "luminarch-aspirant-counter")
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
            { type: "PHASE_BEGIN", phase: "BEGINNING_OF_COMBAT", activePlayerId: "p1" },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("wire format: the +1/+1 counter survives projectPublicState", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                { type: "PHASE_BEGIN", phase: "BEGINNING_OF_COMBAT", activePlayerId: "p1" },
            ])
        );
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find((c) => c.id === "aspirant")!;
        expect(getEffectivePower(projected, live)).toBe(2);
    });
});
