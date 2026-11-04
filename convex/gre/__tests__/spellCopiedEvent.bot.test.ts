// SPELL_COPIED census row 4 (`spellCopiedEvent.test.ts`): the search sandbox
// must play the same game as the server. A sandbox cast is not a copy, and a
// storm copy made inside the search fires the same "or copy" trigger the server
// does, so the Bot reads Magecraft's drain on a copied spell (CR 707.10).

import { describe, expect, it } from "vitest";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { resolveTopOfStack, getPlayer, type GameState } from "../state";
import { preloadDefinitions } from "../../cards";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { lightningBolt } from "../../cards/sets/lea/index.cards";
import { emptyTheWarrens } from "../../cards/sets/tsp/red.cards";
import { witherbloomApprentice } from "../../cards/sets/stx/multicolor.cards";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([witherbloomApprentice()]);

function position(hand: { id: string; cardId: string }[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(witherbloomApprentice().id, {
                        id: "apprentice",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                hand: hand.map(({ id, cardId }) =>
                    makeInstance(cardId, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const cast = (cardInstanceId: string, playerTarget?: string): Move => ({
    kind: "cast-spell",
    cardInstanceId,
    targets: playerTarget ? [{ type: "player", id: playerTarget }] : [],
    confirmTargets: false,
    tapPlan: [],
});

const magecraftEventTypes = (state: GameState) =>
    state.stack
        .filter(
            (s) => s.triggeredAbilityId === "witherbloom-apprentice-magecraft"
        )
        .map((s) => s.triggerEvent?.type);

describe("SPELL_COPIED in the search sandbox (CR 707.10)", () => {
    it("row 4: an applyMoveInSearch cast is a SPELL_CAST and never a SPELL_COPIED", () => {
        const state = position([{ id: "bolt", cardId: lightningBolt().id }]);
        applyMoveInSearch(state, "p1", cast("bolt", "p2"));
        expect(magecraftEventTypes(state)).toEqual(["SPELL_CAST"]);
    });

    it("row 4: an applyMoveForSearch cast drains exactly once, for the cast alone", () => {
        // The greedy sandbox plays the move out to a stable point, so the trigger
        // is observed by its effect: a second drain would mean a phantom copy.
        const after = applyMoveForSearch(
            position([{ id: "bolt", cardId: lightningBolt().id }]),
            "p1",
            cast("bolt", "p2")
        );
        expect(getPlayer(after, "p1").life).toBe(21);
    });

    it("a storm copy made inside the search fires Magecraft like the server does", () => {
        const state = position([
            { id: "warrens", cardId: emptyTheWarrens().id },
        ]);
        state.spellsCastThisTurn = 1;
        applyMoveInSearch(state, "p1", cast("warrens"));
        for (let step = 0; step < 32 && state.stack.length > 0; step++) {
            resolveTopOfStack(state);
        }
        // One cast + one copy.
        expect(getPlayer(state, "p2").life).toBe(18);
    });
});
