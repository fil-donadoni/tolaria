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
import { projectPublicState } from "../../../../gameProjections";

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

        // Scry: top two are a, b. Keep "b" on top, put "a" on the bottom.
        // order-top payload: kept top (topmost first) + the un-kept `secondZoneIds`.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("library-bottom");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
            secondZoneIds: ["a"],
        });

        // "b" was kept on top → it is drawn; "a" is now at the true bottom.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toHaveLength(3);
        expect(libIds[libIds.length - 1]).toBe("a");
    });

    it("wire format: exposes exactly the top two to the chooser, not the whole library, not the opponent (#942)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, preordain.id, "p1");
        resolveTopOfStack(state); // suspends on the scry (look-top) choice

        // Chooser's view: exactly the top two are face-up as `libraryPeek` —
        // the fix for `partition` exposing NOTHING on the wire (the scry was a
        // no-op from the player's perspective).
        const chooserView = projectPublicState(state, 1, "p1");
        const me = chooserView.players[0];
        expect(me.libraryPeek?.map((c) => c.id)).toEqual(["a", "b"]);
        expect(me.librarySearch).toBeUndefined();
        expect(me.library.count).toBe(4);
        expect(me.library.known ?? []).toEqual([]);

        // Opponent's view: no leak.
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].libraryPeek).toBeUndefined();
        expect(oppView.players[0].librarySearch).toBeUndefined();
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
        // Keep both on top in original order; nothing to the bottom.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a", "b"],
            secondZoneIds: [],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("honours the chosen TOP order — reordering the kept cards changes which is drawn", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, preordain.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // Top two are a,b. Keep both but put "b" ON TOP (drawn first).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b", "a"],
            secondZoneIds: [],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        // "a" is now the new top of the library (index 0).
        expect(state.players[0].library.map((c) => c.id)).toEqual(["a", "c"]);
    });
});
