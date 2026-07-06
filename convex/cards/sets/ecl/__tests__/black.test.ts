// ECL — black card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { moonshadow } from "../black";
import { balduvianBears } from "../../ice";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    discardToGraveyard,
    emitPermanentEntered,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

// Moonshadow — {B} Creature — Elemental (CR 702.111 menace; CR 122.1
// -1/-1 counters; CR 603.2 zone-change triggers).
describe("Moonshadow (CR 702.111 menace; CR 122.1 counters; CR 603.2 graveyard-from-anywhere trigger)", () => {
    function setup() {
        const shadow = makeInstance(moonshadow.id, {
            id: "shadow",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(balduvianBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [shadow, other],
                    hand: [
                        makeInstance(balduvianBears.id, {
                            id: "hand-permanent",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, shadow, other };
    }

    it("shape: 7/7 for {B} with menace and three triggered abilities declared", () => {
        expect(moonshadow.manaCost).toEqual({ B: 1 });
        expect(moonshadow.power).toBe(7);
        expect(moonshadow.toughness).toBe(7);
        expect(moonshadow.staticAbilities).toContain("menace");
        expect(moonshadow.triggeredAbilities).toHaveLength(3);
    });

    it("enters the battlefield with six -1/-1 counters", () => {
        const { state, shadow } = setup();
        emitPermanentEntered(state, shadow);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(6);
    });

    it("removes a -1/-1 counter when a permanent card it owns dies (battlefield → graveyard)", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });

    it("does NOT fire for a permanent leaving to a non-graveyard zone (e.g. bounce)", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        removePermanentTo(state, "other", "hand");
        processPendingActionTriggers(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(6);
    });

    it("removes a -1/-1 counter when the controller discards a permanent card from hand", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        discardToGraveyard(state, "p1", "hand-permanent");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });

    it("clamps at zero (no counter to remove) instead of going negative", () => {
        const { state } = setup();
        // No counters seeded — the trigger's remove is a safe no-op.
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"] ?? 0).toBe(0);
    });

    it("wire format: the remaining -1/-1 counter count survives projectPublicState", () => {
        const { state } = setup();
        state.players[0].battlefield.find((c) => c.id === "shadow")!.counters =
            { "-1/-1": 6 };
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });
});
