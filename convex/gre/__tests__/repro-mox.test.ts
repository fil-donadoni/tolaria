import { describe, it, expect } from "vitest";
import { getCardByName, getInstanceManaCost } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { assertLegalAction } from "../rules";
import {
    getPlayer,
    getOpponentId,
    removeFromZone,
    normalizeManaCost,
    getCostModifiers,
    applyCostModifiers,
    emitSpellCastEvent,
    processPendingActionTriggers,
    type StackItem,
    type GameState,
} from "../state";
import { drainAutoPasses } from "../phases";
import { compactState, expandState } from "../serialize";

describe("repro: cast Mox Sapphire turn 1", () => {
    it("runs the announceCast pure path without throwing", () => {
        const mox = getCardByName("Mox Sapphire");
        const moxInst = makeInstance(mox.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [makePlayer("p1", { hand: [moxInst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find((c) => c.id === moxInst.id)!;
        assertLegalAction(state, player, cardInHand, "cast");

        const rawCost = getInstanceManaCost(cardInHand);
        const manaCost = rawCost ? normalizeManaCost(rawCost, {}) : {};
        applyCostModifiers(
            manaCost,
            getCostModifiers(state, cardInHand, "spell")
        );
        expect(Object.keys(manaCost).length).toBe(0);

        const card = removeFromZone(state, player, moxInst.id, "hand");
        const stackItem: StackItem = { ...card, castById: "p1" };
        state.stack.push(stackItem);
        state.passCount = 0;
        state.priorityPlayerId = getOpponentId(state, "p1");
        state.singleShotAutoPass = "p1";
        drainAutoPasses(state);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);

        // round-trip through serialization (saveGameState path)
        const round = expandState(compactState(state));
        expect(round).toBeTruthy();
    });
});
