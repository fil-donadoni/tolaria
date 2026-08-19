// 5DN — colorless cards, BOT-suite coverage (`*.bot.test.ts` per the
// bot-suite boundary guard, `scripts/__tests__/bot-suite-boundary.test.ts`:
// this file imports `convex/gre/moves`).
//
// Pentad Prism's "Add one mana of any color" is a real CR 700.2 MODE choice,
// not a colour the engine picks for the player (issue #2378 acceptance
// criterion "the mana-of-any-color choice on activation is a real Move-level
// decision, not silently defaulted"). The proof that it is Move-level has to
// come from the enumerator the Brain actually searches over — a card-definition
// read would prove only that the definition equals itself.

import { describe, it, expect } from "vitest";
import { pentadPrism } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { enumerateMoves } from "../../../../gre/moves";
import type { GameState } from "../../../../gre/state";

function boardWithCharges(charge: number): GameState {
    const prism = makeInstance(pentadPrism.id, {
        id: "prism",
        controllerId: "p1",
        ownerId: "p1",
        ...(charge > 0 ? { counters: { charge } } : {}),
    });
    return makeState({
        players: [makePlayer("p1", { battlefield: [prism] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function prismActivations(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "prism" &&
            m.abilityId === "pentad-prism-any-color"
    ) as Extract<
        ReturnType<typeof enumerateMoves>[number],
        { kind: "activate-ability" }
    >[];
}

describe("Pentad Prism — the any-colour mana choice is a Move-level decision (CR 700.2)", () => {
    it("enumerates ONE move per colour, so the search picks the colour", () => {
        const moves = prismActivations(boardWithCharges(1));
        expect(moves.map((m) => m.chosenModeId).sort()).toEqual([
            "add-b",
            "add-g",
            "add-r",
            "add-u",
            "add-w",
        ]);
    });

    it("CR 118.4 — with no charge counters the activation is not offered at all", () => {
        expect(prismActivations(boardWithCharges(0))).toEqual([]);
    });
});
