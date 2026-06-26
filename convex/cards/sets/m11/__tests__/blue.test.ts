// Magic 2011 (M11) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { preordain } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(preordain.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Preordain (scry 2 then draw; CR 701.42 / 121.1)", () => {
    it("is a {U} sorcery", () => {
        expect(preordain.manaCost).toEqual({ U: 1 });
        expect(preordain.types).toEqual(["Sorcery"]);
    });

    it("puts a chosen looked-at card on the bottom, keeps the other on top, then draws it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, preordain.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the scry choice

        // Scry: top two are a, b. Put "a" on the bottom, keep "b" on top.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
        });

        // "b" was on top → it is drawn; "a" is now at the bottom.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toHaveLength(3);
        expect(libIds[libIds.length - 1]).toBe("a");
    });

    it("keeping both on top draws the original top card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, preordain.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // Put nothing on the bottom.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(2);
    });
});
