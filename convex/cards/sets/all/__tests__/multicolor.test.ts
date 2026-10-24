// ALL (Alliances) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import type { GameState } from "../../../../gre/types";

const vault = getDefinition("f9b0164c-2d4e-48ab-addd-322d9b504739");

const IDS = "abcdefghijkl".split("");

function vaultState(life = 20): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                life,
                library: IDS.map((id) =>
                    makeInstance(vault.id, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, vault.id, "p1");
    return state;
}

function libraryIds(state: GameState): string[] {
    return state.players[0].library.map((c) => c.id);
}

/** Answers the head `order-top` choice with `order` (top first). */
function arrange(state: GameState, order: string[]): void {
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("order-top");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: order,
        secondZoneIds: [],
    });
}

function answerPay(state: GameState, accept: boolean): void {
    expect(state.pendingChoices![0].kind).toBe("may-pay");
    applyMayPaySubmit(state, { playerId: "p1", accept });
}

// Lim-Dûl's Vault (CR 401.4 look, CR 119.4 pay life, CR 701.24 shuffle) —
// "Look at the top five cards of your library. As many times as you choose,
// you may pay 1 life, put those cards on the bottom of your library in any
// order, then look at the top five cards of your library. Then shuffle and put
// the last cards you looked at this way on top in any order."
describe("Lim-Dûl's Vault", () => {
    it("looks at the top five cards first, face-up to the caster on the wire", () => {
        const state = vaultState();
        expect(resolveTopOfStack(state)).toBeNull();
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].libraryPeek?.map((c) => c.id)).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
        ]);
    });

    it("declining at once puts the five cards back on top in the chosen order, after a shuffle", () => {
        const state = vaultState();
        resolveTopOfStack(state);
        arrange(state, ["c", "a", "e", "b", "d"]);
        answerPay(state, false);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(20);
        expect(libraryIds(state).slice(0, 5)).toEqual([
            "c",
            "a",
            "e",
            "b",
            "d",
        ]);
        // The rest of the library was shuffled, but nothing was lost.
        expect([...libraryIds(state)].sort()).toEqual(IDS);
    });

    it("paying once bottoms the five in the arranged order and looks at the next five", () => {
        const state = vaultState();
        resolveTopOfStack(state);
        arrange(state, ["e", "d", "c", "b", "a"]);
        answerPay(state, true);
        expect(state.players[0].life).toBe(19);
        // The next look is on the following five cards.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].libraryPeek?.map((c) => c.id)).toEqual([
            "f",
            "g",
            "h",
            "i",
            "j",
        ]);
        expect(libraryIds(state)).toEqual([
            "f",
            "g",
            "h",
            "i",
            "j",
            "k",
            "l",
            "e",
            "d",
            "c",
            "b",
            "a",
        ]);
        arrange(state, ["j", "i", "h", "g", "f"]);
        answerPay(state, false);
        expect(libraryIds(state).slice(0, 5)).toEqual([
            "j",
            "i",
            "h",
            "g",
            "f",
        ]);
        expect(state.players[0].life).toBe(19);
        expect([...libraryIds(state)].sort()).toEqual(IDS);
    });

    it("can be repeated as many times as the player chooses, each costing 1 life", () => {
        const state = vaultState();
        resolveTopOfStack(state);
        arrange(state, ["a", "b", "c", "d", "e"]);
        answerPay(state, true); // looks at f..j
        arrange(state, ["f", "g", "h", "i", "j"]);
        answerPay(state, true); // looks at k, l, then the bottomed a..e
        expect(state.players[0].life).toBe(18);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        arrange(state, ["k", "l", "a", "b", "c"]);
        answerPay(state, false);
        expect(libraryIds(state).slice(0, 5)).toEqual([
            "k",
            "l",
            "a",
            "b",
            "c",
        ]);
        expect([...libraryIds(state)].sort()).toEqual(IDS);
    });
});
