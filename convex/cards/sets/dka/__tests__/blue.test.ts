// Dark Ascension (DKA) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { thoughtScour } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

const libFor = (owner: string, ids: string[]) =>
    ids.map((id) =>
        makeInstance(thoughtScour.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );

describe("Thought Scour (target mills two, draw one; CR 701.13a / 121.1)", () => {
    it("is a {U} instant targeting a player", () => {
        expect(thoughtScour.manaCost).toEqual({ U: 1 });
        expect(thoughtScour.types).toEqual(["Instant"]);
        expect(thoughtScour.targetRequirement).toMatchObject({
            type: "player",
            count: 1,
        });
    });

    it("mills the target's top two cards and draws one for the caster", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: libFor("p1", ["draw1"]) }),
                makePlayer("p2", {
                    library: libFor("p2", ["m1", "m2", "m3"]),
                }),
            ],
        });
        pushSpell(state, thoughtScour.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "m1",
            "m2",
        ]);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["m3"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["draw1"]);
    });

    it("wire format: the mill and draw survive projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: libFor("p1", ["draw1"]) }),
                makePlayer("p2", { library: libFor("p2", ["m1", "m2"]) }),
            ],
        });
        pushSpell(state, thoughtScour.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
        expect(projected.players[1].graveyard.length).toBe(2);
    });
});
