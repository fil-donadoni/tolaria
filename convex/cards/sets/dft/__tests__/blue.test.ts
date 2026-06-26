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
