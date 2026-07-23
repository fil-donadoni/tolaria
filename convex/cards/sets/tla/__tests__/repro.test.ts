import { describe, it, expect } from "vitest";
import { badgermoleCub } from "../green";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    processPendingActionTriggers,
    destroyWithReplacements,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardInstanceState, GameState, StackItem } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";

function earthbendTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "badgermole-earthbend-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "badgermole-cub-earthbend",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            cardId: badgermoleCub.id,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

function earthbend(landId: string): GameState {
    const cub = makeInstance(badgermoleCub.id, {
        id: `cub-${landId}`,
        controllerId: "p1",
        ownerId: "p1",
    });
    const land = makeInstance(forest.id, {
        id: landId,
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [cub, land] }), makePlayer("p2")],
    });
    earthbendTriggerOnStack(state, cub);
    raiseTriggerTargetSelection(state);
    resolveTopOfStack(state);
    return state;
}

function drain(state: GameState): void {
    processPendingActionTriggers(state);
    while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
        resolveTopOfStack(state);
    }
}

describe("repro", () => {
    it("survives a serialize round-trip", () => {
        const state = earthbend("rt");
        const round = expandState(compactState(state));
        expect(round.delayedTriggers?.length).toBe(1);
        expect(round.delayedTriggers?.[0].watchInstanceId).toBe("rt");
        expect(round.delayedTriggers?.[0].payload).toEqual({ land: "rt" });
    });

    it("returns after a real destroy + SBA", () => {
        const state = earthbend("destroyed");
        destroyWithReplacements(state, "destroyed");
        checkStateBasedActions(state);
        drain(state);
        expect(state.players[0].battlefield.some((c) => c.id === "destroyed")).toBe(
            true
        );
    });

    it("returns after a serialize round-trip then destroy", () => {
        let state = earthbend("rtd");
        state = expandState(compactState(state));
        destroyWithReplacements(state, "rtd");
        checkStateBasedActions(state);
        drain(state);
        expect(state.players[0].battlefield.some((c) => c.id === "rtd")).toBe(true);
    });
});
