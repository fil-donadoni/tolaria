// Aetherdrift (DFT) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { stockUp } from "../blue";
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
        makeInstance(stockUp.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Stock Up (look 5, two to hand, rest to bottom; CR 401.4 / 401)", () => {
    it("is a {2}{U} sorcery", () => {
        expect(stockUp.manaCost).toEqual({ X: 2, U: 1 });
        expect(stockUp.types).toEqual(["Sorcery"]);
    });

    it("puts two chosen cards into hand and the rest on the bottom", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: lib(["a", "b", "c", "d", "e", "f", "g"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, stockUp.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the keep choice

        // Top five are a..e; keep "a" and "c".
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a", "c"],
        });

        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "a",
            "c",
        ]);
        // b, d, e (the rest of the looked-at five) are now on the bottom; f, g
        // (already below the top five) remain above them.
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toHaveLength(5);
        expect(libIds.slice(-3).sort()).toEqual(["b", "d", "e"]);
        expect(libIds.slice(0, 2)).toEqual(["f", "g"]);
    });

    it("wire format: exposes exactly the top five to the chooser, not the whole library, not the opponent (#942)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: lib(["a", "b", "c", "d", "e", "f", "g"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, stockUp.id, "p1");
        resolveTopOfStack(state); // suspends on the look-top choice

        // Chooser's view: exactly the top five are face-up as `libraryPeek`.
        const chooserView = projectPublicState(state, 1, "p1");
        const me = chooserView.players[0];
        expect(me.libraryPeek?.map((c) => c.id)).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
        ]);
        // NOT the whole library: `librarySearch` (the full face-up array) stays
        // unset, and the projected library never crosses the wire face-up (it is
        // a sparse `{ count }`, seven cards deep).
        expect(me.librarySearch).toBeUndefined();
        expect(me.library.count).toBe(7);
        expect(me.library.known ?? []).toEqual([]);

        // Opponent's view: the peek is the chooser's private knowledge — it must
        // not leak to p2.
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].libraryPeek).toBeUndefined();
        expect(oppView.players[0].librarySearch).toBeUndefined();
    });

    it("wire format: drew two cards survives projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d", "e"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, stockUp.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a", "b"],
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[0].library.count).toBe(3);
    });
});
