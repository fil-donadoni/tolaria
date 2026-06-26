// Weatherlight (WTH) — colorless card behavior tests (ADR 0043 colour split).
// Each describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { mindStone } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

const FOREST = getCardByName("Forest").id;

/** Push an activated ability onto the stack (cost assumed paid) and resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

function libraryOf(n: number, owner = "p1"): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(FOREST, {
            id: `${owner}-lib${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

describe("Mind Stone (mana rock + sacrifice cantrip, CR 605 / 121.1)", () => {
    it("registers and has a colourless {C} mana ability (useStack:false)", () => {
        expect(getCardByName("Mind Stone")).toBe(mindStone);
        expect(mindStone.manaCost).toEqual({ X: 2 });
        const mana = mindStone.activatedAbilities!.find(
            (a) => a.id === "mind-stone-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("the sacrifice ability draws a card on resolution", () => {
        const stone = makeInstance(mindStone.id, {
            id: "stone",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone],
                    library: libraryOf(3),
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, stone, "mind-stone-draw");
        expect(state.players[0].hand.length).toBe(1);

        // Wire format: the drawn card survives the projection (CR 121.1).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });
});
