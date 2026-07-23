// cancelTriggerTargetSelection (CR 603.3c/603.3d) — cancelling a triggered
// ability's target must not leave the trigger on the stack with
// `targets: undefined`, which would resolve doing nothing (an emblem's
// "deal 5 damage to any target" silently dealing 0 — the Chandra, Torch of
// Defiance −7 emblem bug). A mandatory target removes the trigger from the
// stack; an "up to" target resolves with no target.

import { describe, it, expect } from "vitest";
import { cancelTriggerTargetSelection } from "../game";
import type { GameState, StackItem } from "../gre/state";
import { makePlayer, makeState } from "../cards/__tests__/setup";

function triggerItem(id: string): StackItem {
    return {
        id,
        card: { id: "chandra-torch-of-defiance-emblem" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: "p1",
        triggeredAbilityId: "chandra-torch-of-defiance-emblem-cast",
        emblemSourceId: "chandra-torch-of-defiance-emblem",
    } as StackItem;
}

function stateWithPendingTrigger(
    count: number | { min: number; max?: number }
): GameState {
    const state = makeState({
        activePlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    const item = triggerItem("emb-trig");
    state.stack.push(item);
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "emb-trig",
        targetType: "any",
        count,
        selected: [],
        kind: "trigger",
    } as GameState["pendingTarget"];
    return state;
}

describe("cancelTriggerTargetSelection (CR 603.3c/603.3d)", () => {
    it("removes a MANDATORY (min 1) trigger from the stack — never a 0-damage resolve", () => {
        const state = stateWithPendingTrigger(1);
        cancelTriggerTargetSelection(state);
        expect(state.stack.find((s) => s.id === "emb-trig")).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("leaves an 'up to' (min 0) trigger on the stack with no target", () => {
        const state = stateWithPendingTrigger({ min: 0, max: 1 });
        cancelTriggerTargetSelection(state);
        const trig = state.stack.find((s) => s.id === "emb-trig");
        expect(trig).toBeDefined();
        expect(trig!.targets).toEqual([]);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("is a no-op when there is no pending trigger target", () => {
        const state = makeState({ players: [makePlayer("p1")] });
        expect(() => cancelTriggerTargetSelection(state)).not.toThrow();
    });
});
