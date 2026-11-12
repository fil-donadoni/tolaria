// Damping Sphere — CR 614.1a (a land tapped for two or more mana produces one
// {C}) and CR 601.2f (each spell costs {1} more per OTHER spell its caster has
// cast this turn).

import { describe, it, expect } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import { dampingSphere } from "../../cards/sets/dom/colorless.cards";
import { forest } from "../../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../state";
import { replaceLandManaType } from "../constants";

const def = dampingSphere();

function board(spellsCast: number, withSphere: boolean): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(forest().id, {
                        id: "frs",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...(withSphere
                        ? [
                              makeInstance(def.id, {
                                  id: "sphere",
                                  controllerId: "p2",
                                  ownerId: "p2",
                              }),
                          ]
                        : []),
                ],
            }),
            makePlayer("p2", {}),
        ],
    });
    state.players[0].spellsCastThisTurn = spellsCast;
    return state;
}

function spellCost(state: GameState, playerId: string) {
    const view = makeInstance(forest().id, {
        id: "spell-view",
        controllerId: playerId,
        zone: "hand",
    });
    const cost = normalizeManaCost({ X: 2 });
    applyCostModifiers(
        cost,
        getCostModifiers(state, view, "spell", undefined, playerId)
    );
    return cost;
}

const bf = (s: GameState) =>
    s.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

describe("Damping Sphere", () => {
    it("taxes each spell {1} per other spell its caster already cast", () => {
        withTemporaryDefinition(def, () => {
            expect(spellCost(board(0, true), "p1").X).toBe(2);
            expect(spellCost(board(1, true), "p1").X).toBe(3);
            expect(spellCost(board(3, true), "p1").X).toBe(5);
            // The opponent's tally is its own: p2 has cast nothing.
            expect(spellCost(board(3, true), "p2").X).toBe(2);
        });
    });

    it("taxes nothing without the Sphere on the battlefield", () => {
        withTemporaryDefinition(def, () => {
            expect(spellCost(board(3, false), "p1").X).toBe(2);
        });
    });

    it("collapses a land tapped for two or more mana to one {C}", () => {
        withTemporaryDefinition(def, () => {
            const state = board(0, true);
            const land = state.players[0].battlefield[0];
            expect(
                replaceLandManaType(state, bf(state), "p1", land, { G: 2 })
            ).toEqual({ C: 1 });
            expect(
                replaceLandManaType(state, bf(state), "p1", land, {
                    G: 1,
                    R: 1,
                })
            ).toEqual({ C: 1 });
            // One mana is left alone.
            expect(
                replaceLandManaType(state, bf(state), "p1", land, { G: 1 })
            ).toEqual({ G: 1 });
        });
    });
});
