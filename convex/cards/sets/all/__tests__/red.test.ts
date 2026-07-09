import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { pyrokinesis } from "../red";

// Pyrokinesis — {4}{R}{R} Instant. "You may exile a red card from your hand
// rather than pay this spell's mana cost. Pyrokinesis deals 4 damage divided as
// you choose among any number of target creatures." (CR 118.9 pitch cost;
// CR 601.2d / 120.4 divide as you choose.)
describe("Pyrokinesis (divided damage — CR 120.4)", () => {
    const treefolk = getCardByName("Ironroot Treefolk"); // 3/5 — survives 2 damage

    it("declares the pitch alternative cost: exile a red card from hand", () => {
        expect(pyrokinesis.alternativeCosts).toEqual([
            {
                id: "pitch-exile-red",
                description: "Exile a red card from your hand",
                handCost: {
                    action: "exile",
                    requirements: [{ filter: { color: "R" }, count: 1 }],
                },
            },
        ]);
        expect(pyrokinesis.targetRequirement).toMatchObject({
            type: "Creature",
            divideAsChosen: { total: 4 },
        });
    });

    it("splits 4 damage across two target creatures as chosen", () => {
        const a = makeInstance(treefolk.id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const b = makeInstance(treefolk.id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        const item = pushSpell(state, pyrokinesis.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.targetAmounts = { "permanent:a": 2, "permanent:b": 2 };
        resolveTopOfStack(state);
        const board = state.players[1].battlefield;
        expect(board.find((c) => c.id === "a")?.damageMarked).toBe(2);
        expect(board.find((c) => c.id === "b")?.damageMarked).toBe(2);
    });

    it("marked damage survives the wire projection (client sees it)", () => {
        const a = makeInstance(treefolk.id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { battlefield: [a] })],
        });
        const item = pushSpell(state, pyrokinesis.id, "p1", [
            { type: "permanent", id: "a" },
        ]);
        item.targetAmounts = { "permanent:a": 4 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 2, "p1");
        const slim = projected.players[1].battlefield.find((c) => c.id === "a");
        expect(slim?.damageMarked).toBe(4);
    });
});
