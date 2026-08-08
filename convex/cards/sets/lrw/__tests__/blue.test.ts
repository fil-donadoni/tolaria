// Lorwyn (LRW) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { ponder } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(ponder.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Ponder (look at top 3, reorder, may shuffle, draw; CR 401 / 121.1)", () => {
    it("reorders the top three, declines the shuffle, then draws the chosen top card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, ponder.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the reorder

        // Reorder the top three so "c" is on top (first = top).
        const head = state.pendingChoices![0];
        const top = head.candidateIds ?? ["a", "b", "c"];
        const reordered = [...top].reverse();
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: reordered,
        });

        // Now suspended on the "you may shuffle" may-pay; decline.
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            accept: false,
        });

        // The card placed on top is drawn.
        expect(state.players[0].hand.map((c) => c.id)).toEqual([reordered[0]]);
        expect(state.players[0].library).toHaveLength(3);
    });

    it("shuffles when the player accepts, then still draws one", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d", "e"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, ponder.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: head.candidateIds ?? ["a", "b", "c"],
        });
        applyMayPaySubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            accept: true,
        });
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(4);
    });
});
