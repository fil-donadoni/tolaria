// CR 603.2 — per-turn TRIGGER cap: "This ability triggers only N times each
// turn" (Nadu, Winged Wisdom's "only twice each turn").
//
// The cap is enforced in the trigger SCAN (`collectTriggers`), not at
// resolution: an over-quota ability never produces a StackItem at all, which is
// what distinguishes it from a trigger that goes on the stack and then fizzles
// (CR 603.4). The tally lives on `CardInstanceState.triggersThisTurn`, the
// trigger twin of `activationsThisTurn` — keyed by ability id and counted PER
// SOURCE OBJECT, so a battlefield-wide grant gives every recipient its own
// quota.

import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameEvent } from "../../cards/types";
import type { GameState } from "../state";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { removePermanentTo } from "../state";
import { advancePhase } from "../phases";

/** A creature whose became-target trigger is capped at two firings per turn —
 *  Nadu's exact shape, reduced to a bare draw so the test observes the SCAN,
 *  not the effect. */
const CAPPED_ID = "test-trigger-cap-creature";
registerTokenDefinition({
    id: CAPPED_ID,
    name: CAPPED_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 3,
    toughness: 4,
    triggeredAbilities: [
        {
            id: "capped-became-target",
            oracleText:
                "Whenever this creature becomes the target of a spell or ability, draw a card. This ability triggers only twice each turn.",
            event: "BECAME_TARGET",
            maxTriggersPerTurn: 2,
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

/** The same ability with NO cap — the control case proving the scan is
 *  unchanged for the overwhelming majority of triggers. */
const UNCAPPED_ID = "test-trigger-uncapped-creature";
registerTokenDefinition({
    id: UNCAPPED_ID,
    name: UNCAPPED_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 3,
    toughness: 4,
    triggeredAbilities: [
        {
            id: "uncapped-became-target",
            oracleText:
                "Whenever this creature becomes the target of a spell or ability, draw a card.",
            event: "BECAME_TARGET",
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

function becameTarget(instanceId: string): GameEvent {
    return {
        type: "BECAME_TARGET",
        target: { type: "permanent", id: instanceId },
        targetControllerId: "p1",
        sourceControllerId: "p1",
        sourceInstanceId: "some-stack-item",
    };
}

function stateWith(defId: string, instanceIds: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: instanceIds.map((id) =>
                    makeInstance(defId, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("per-turn trigger cap (CR 603.2)", () => {
    it("fires up to the cap, then stops producing stack items", () => {
        const state = stateWith(CAPPED_ID, ["c1"]);
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(1);
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(1);
        // Third targeting this turn: over quota — the ability does not fire, so
        // nothing reaches the stack at all (CR 603.2).
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(0);
        expect(state.players[0].battlefield[0].triggersThisTurn).toEqual({
            "capped-became-target": 2,
        });
    });

    it("counts every firing within ONE event batch against the same cap", () => {
        const state = stateWith(CAPPED_ID, ["c1"]);
        // Three simultaneous targetings: only the first two may fire.
        const out = collectTriggers(state, [
            becameTarget("c1"),
            becameTarget("c1"),
            becameTarget("c1"),
        ]);
        expect(out).toHaveLength(2);
    });

    it("leaves an UNCAPPED ability's scan untouched", () => {
        const state = stateWith(UNCAPPED_ID, ["c1"]);
        for (let i = 0; i < 5; i++) {
            expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(
                1
            );
        }
        // No tally is allocated for an uncapped ability — the common path
        // stays allocation-free.
        expect(
            state.players[0].battlefield[0].triggersThisTurn
        ).toBeUndefined();
    });

    it("gives each SOURCE OBJECT its own quota (the granted-ability case)", () => {
        const state = stateWith(CAPPED_ID, ["c1", "c2"]);
        collectTriggers(state, [becameTarget("c1")]);
        collectTriggers(state, [becameTarget("c1")]);
        // c1 is spent; c2 has not triggered at all yet.
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(0);
        expect(collectTriggers(state, [becameTarget("c2")])).toHaveLength(1);
        expect(collectTriggers(state, [becameTarget("c2")])).toHaveLength(1);
        expect(collectTriggers(state, [becameTarget("c2")])).toHaveLength(0);
    });

    it("resets the tally at the turn boundary", () => {
        const state = stateWith(CAPPED_ID, ["c1"]);
        collectTriggers(state, [becameTarget("c1")]);
        collectTriggers(state, [becameTarget("c1")]);
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(0);

        // CLEANUP → the next turn begins, and the per-turn tallies clear.
        state.phase = "CLEANUP";
        advancePhase(state);

        expect(
            state.players[0].battlefield[0].triggersThisTurn
        ).toBeUndefined();
        expect(collectTriggers(state, [becameTarget("c1")])).toHaveLength(1);
    });

    it("survives the serialization round-trip — a save/load does not refund spent triggers", () => {
        const state = stateWith(CAPPED_ID, ["c1"]);
        collectTriggers(state, [becameTarget("c1")]);
        collectTriggers(state, [becameTarget("c1")]);

        const restored = expandState(compactState(state));
        expect(restored.players[0].battlefield[0].triggersThisTurn).toEqual({
            "capped-became-target": 2,
        });
        expect(collectTriggers(restored, [becameTarget("c1")])).toHaveLength(0);
    });

    it("clears the tally when the permanent leaves the battlefield (CR 400.7 — a new object)", () => {
        const state = stateWith(CAPPED_ID, ["c1"]);
        collectTriggers(state, [becameTarget("c1")]);
        collectTriggers(state, [becameTarget("c1")]);

        removePermanentTo(state, "c1", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "c1")!;
        expect(inHand.triggersThisTurn).toBeUndefined();
    });
});
