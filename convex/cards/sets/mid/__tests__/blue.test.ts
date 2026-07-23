// MID — blue behavior tests (ADR 0043 colour split).
//
// Consider is a pure-DSL card reusing already-shipped Ops (`scryReorder` with
// the surveil variant `destination: "graveyard"` + `draw`). The smoke
// generator emits an explicit skip-with-reason for `scryReorder` (it suspends
// for a live order-top choice the canned generator can't drive), so per the
// per-Op regime this card earns a minimal hand-written surveil-then-draw
// behavior test (CR 701.25 Surveil, CR 121.1 draw).

import { describe, it, expect } from "vitest";
import { consider } from "../blue";
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
        makeInstance(consider.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Consider (surveil 1 then draw; CR 701.25 / 121.1)", () => {
    it("is a {U} instant", () => {
        expect(consider.manaCost).toEqual({ U: 1 });
        expect(consider.types).toEqual(["Instant"]);
    });

    it("keeping the top card on top draws it (surveil into graveyard declined)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consider.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the surveil choice

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("graveyard");
        // Surveil 1: keep "a" on top (put nothing into the graveyard).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
            secondZoneIds: [],
        });

        // "a" stayed on top → it is the card drawn; it did NOT go to the
        // graveyard (the graveyard holds only the resolved Consider spell).
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b", "c"]);
        expect(state.players[0].graveyard.some((c) => c.id === "a")).toBe(
            false
        );
    });

    it("putting the top card into the graveyard draws the next card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consider.id, "p1");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        // Surveil 1: put "a" into the graveyard (keep nothing on top).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["a"],
        });

        // "a" went to the graveyard; "b" is the new top → it is drawn.
        expect(state.players[0].graveyard.some((c) => c.id === "a")).toBe(true);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["c"]);
    });
});
