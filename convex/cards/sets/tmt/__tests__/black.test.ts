// TMT — black card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { superShredder } from "../black";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Super Shredder — {1}{B} Legendary Creature — Mutant Ninja Human, 1/1
// (CR 702.111 menace; CR 603.2 PERMANENT_LEFT trigger; CR 122 self counter).
// "Menace\nWhenever another permanent leaves the battlefield, put a +1/+1
// counter on Super Shredder."
describe("Super Shredder (CR 702.111 menace; CR 603.2 leaves-the-battlefield trigger; CR 122 self counter)", () => {
    function setup() {
        const shredder = makeInstance(superShredder.id, {
            id: "shredder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(superShredder.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [shredder, other] })],
        });
        return { state, shredder, other };
    }

    it("shape: 1/1 legendary for {1}{B} with menace and the leave-trigger declared", () => {
        expect(superShredder.manaCost).toEqual({ X: 1, B: 1 });
        expect(superShredder.power).toBe(1);
        expect(superShredder.toughness).toBe(1);
        expect(superShredder.staticAbilities).toContain("menace");
        expect(superShredder.triggeredAbilities).toHaveLength(1);
    });

    it("puts a +1/+1 counter on itself when ANOTHER permanent leaves the battlefield", () => {
        const { state } = setup();
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shredder"
        )!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
    });

    it("does NOT put a counter on itself when IT is the permanent leaving", () => {
        const { state } = setup();
        removePermanentTo(state, "shredder", "graveyard");
        processPendingActionTriggers(state);
        const dead = state.players[0].graveyard.find(
            (c) => c.id === "shredder"
        )!;
        expect(dead.counters?.["+1/+1"]).toBeUndefined();
    });

    it("fires for ANY permanent leaving, not just deaths (e.g. exile)", () => {
        const { state } = setup();
        removePermanentTo(state, "other", "exile");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shredder"
        )!;
        expect(live.counters?.["+1/+1"]).toBe(1);
    });

    it("wire format: the self +1/+1 counter survives projectPublicState", () => {
        const { state } = setup();
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "shredder"
        )!;
        expect(getEffectivePower(projected, live)).toBe(2);
    });
});
