// Invasion (INV) — blue behavior tests (ADR 0043 colour split).
//
// Opt is a pure-DSL card reusing already-shipped Ops (`scryReorder` + `draw`,
// issue #885). The catalogue-wide static sweep (effectScripts.test.ts) and the
// auto-generated smoke sweep cover most DSL cards without a hand-written test —
// but the smoke generator emits an explicit skip-with-reason for `scryReorder`
// (it suspends for a live order-top choice the canned generator can't drive), so
// per the per-Op regime this card earns a minimal hand-written scry-then-draw
// behavior test (CR 701.22 Scry, CR 121.1 draw).

import { describe, it, expect } from "vitest";
import { opt } from "../blue";
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
        makeInstance(opt.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Opt (scry 1 then draw; CR 701.22 / 121.1)", () => {
    it("is a {U} instant", () => {
        expect(opt.manaCost).toEqual({ U: 1 });
        expect(opt.types).toEqual(["Instant"]);
    });

    it("keeping the top card on top draws it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, opt.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the scry choice

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("library-bottom");
        // Scry 1: keep "a" on top.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
            secondZoneIds: [],
        });

        // "a" stayed on top → it is the card drawn.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b", "c"]);
    });

    it("sending the top card to the bottom draws the next card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, opt.id, "p1");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        // Scry 1: put "a" on the bottom (keep nothing on top).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["a"],
        });

        // "b" is the new top → it is drawn; "a" sits at the true bottom.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toEqual(["c", "a"]);
    });
});
