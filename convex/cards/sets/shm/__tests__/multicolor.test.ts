// SHM — multicolor behaviour tests (ADR 0043 colour split). Manamorphose's
// Effect Script is skipped by the generated smoke sweep (its `forEach
// { set: "times" }` body is an `optionChoice` the canned generator cannot
// answer), so the card owes its own test (issue #1368).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const manamorphose = getDefinition("50283122-b8c4-4fb3-8eba-6252b72222f4");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(forest.id, {
                        id: "top",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function pool(state: GameState): Record<string, number> {
    return Object.fromEntries(
        Object.entries(state.players[0].manaPool).filter(([, n]) => n > 0)
    );
}

describe("Manamorphose — two mana in any combination of colors, then draw (CR 106.1a)", () => {
    it("asks twice, independently: two different colours", () => {
        const state = board();
        pushSpell(state, manamorphose.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].options?.map((o) => o.id)).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
        submitChoice(state, ["W"]);
        // The draw waits for the second colour.
        expect(state.players[0].hand).toHaveLength(0);
        submitChoice(state, ["B"]);
        expect(pool(state)).toEqual({ W: 1, B: 1 });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("the same colour twice is a legal combination", () => {
        const state = board();
        pushSpell(state, manamorphose.id, "p1");
        resolveTopOfStack(state);
        submitChoice(state, ["G"]);
        submitChoice(state, ["G"]);
        expect(pool(state)).toEqual({ G: 2 });
        expect(state.players[0].hand).toHaveLength(1);
    });
});
