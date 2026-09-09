// ROE — white card behavior tests (ADR 0043 colour split). Oust separates two
// player references the CR keeps apart and a naive reading collapses: the card
// goes to its OWNER's library (CR 400.3) while its CONTROLLER gains the life
// (CR 109.5), read as last known information (CR 608.2h) because the creature
// is already gone by the time the life gain runs.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const oust = getDefinition("07313dd3-d0dc-40ca-98a3-fa4d39e5bcae");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");

/** `n` filler cards in a player's library, index 0 = the top. */
function library(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(forest.id, {
            id: `${playerId}-lib${i}`,
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
        })
    );
}

describe("Oust (CR 400.3 owner's library, 109.5 'its controller', 608.2h LKI — issue #3228)", () => {
    it("puts the creature SECOND from the top of its owner's library and gives its controller 3 life", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", 3) }),
                makePlayer("p2", {
                    battlefield: [bear],
                    library: library("p2", 3),
                }),
            ],
        });
        pushSpell(state, oust.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        // Off the battlefield…
        expect(state.players[1].battlefield).toHaveLength(0);
        // …and second from the top (index 1), not on top and not shuffled in.
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "p2-lib0",
            "bear",
            "p2-lib1",
            "p2-lib2",
        ]);
        // "Its controller", not the caster: p2 gains, p1 does not.
        expect(state.players[1].life).toBe(23);
        expect(state.players[0].life).toBe(20);
    });

    it("owner and controller diverge: the card goes to its OWNER's library, the CONTROLLER gains the life", () => {
        // A stolen bear — owned by p2, controlled by p1 (CR 108.3 / 109.5).
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bear],
                    library: library("p1", 3),
                }),
                makePlayer("p2", { library: library("p2", 3) }),
            ],
        });
        pushSpell(state, oust.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        // Owner's library (p2), second from the top.
        expect(state.players[1].library[1].id).toBe("bear");
        expect(state.players[0].library.some((c) => c.id === "bear")).toBe(
            false
        );
        // Controller (p1) gains the 3 life — read as LKI after the move.
        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(20);
    });

    it("a library shorter than the position puts the card on the bottom (the Teferi ruling)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", 3) }),
                makePlayer("p2", { battlefield: [bear], library: [] }),
            ],
        });
        pushSpell(state, oust.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["bear"]);
    });

    it("wire format: the library move and the life gain survive projectPublicState", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", 3) }),
                makePlayer("p2", {
                    battlefield: [bear],
                    library: library("p2", 3),
                }),
            ],
        });
        pushSpell(state, oust.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[1].life).toBe(23);
    });
});
