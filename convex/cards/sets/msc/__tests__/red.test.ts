// Batroc the Leaper (issue #7226) — CR 702.33e kicker count read twice: the
// ETB +1/+1 counters (CR 614.1c) and the trigger's target bound (CR 601.2c).

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { finalizeTargetSelection } from "../../../../game";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { batrocTheLeaper } from "../red.cards";
import type { CardDefinition } from "../../../types";

const GIANT: CardDefinition = {
    id: "test-batroc-giant",
    rarity: "common",
    name: "Batroc Test Giant",
    types: ["Creature"],
    subtypes: ["Giant"],
    manaCost: { X: 5 },
    power: 5,
    toughness: 5,
};

describe("Batroc the Leaper", () => {
    it("kicked twice: enters as a 4/4 and deals 4 to a creature and a player", () => {
        const batroc = batrocTheLeaper();
        withTemporaryDefinition(GIANT, () =>
            withTemporaryDefinition(batroc, () => {
                const state = makeState({
                    players: [
                        makePlayer("p1"),
                        makePlayer("p2", {
                            battlefield: [
                                makeInstance(GIANT.id, {
                                    id: "g1",
                                    controllerId: "p2",
                                    ownerId: "p2",
                                }),
                            ],
                        }),
                    ],
                });
                pushSpell(state, batroc.id, "p1").kickerPayments = {
                    multikicker: 2,
                };
                resolveTopOfStack(state);
                processPendingActionTriggers(state);
                const life = state.players[1].life;
                expect(state.pendingTarget?.count).toEqual({ min: 0, max: 2 });
                state.pendingTarget!.selected = [
                    { type: "permanent", id: "g1" },
                    { type: "player", id: "p2" },
                ] as never;
                finalizeTargetSelection(
                    state,
                    state.pendingTarget!,
                    state.pendingTarget!.playerId
                );
                resolveTopOfStack(state);
                expect(
                    state.players[1].battlefield.find((c) => c.id === "g1")
                        ?.damageMarked
                ).toBe(4);
                expect(state.players[1].life).toBe(life - 4);
            })
        );
    });
});
