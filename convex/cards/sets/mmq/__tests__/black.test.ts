import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { snuffOut } from "../black";

// Snuff Out — {3}{B} Instant. "If you control a Swamp, you may pay 4 life rather
// than pay this spell's mana cost. Destroy target nonblack creature. It can't be
// regenerated." (CR 118.9 pitch cost; CR 701.7 destroy; CR 701.15c no-regen.)
describe("Snuff Out (destroy nonblack creature, can't regenerate — CR 701.7)", () => {
    const bears = getCardByName("Grizzly Bears"); // green 2/2 — a nonblack creature

    it("declares the pitch alternative cost: pay 4 life if you control a Swamp", () => {
        expect(snuffOut.alternativeCosts).toEqual([
            {
                id: "pitch-pay-4-life",
                description: "Pay 4 life",
                life: 4,
                condition: { kind: "control", filter: { subtypes: "Swamp" } },
            },
        ]);
        expect(snuffOut.targetRequirement).toMatchObject({
            type: "Creature",
            excludeColors: "B",
        });
    });

    it("destroys the target creature", () => {
        const victim = makeInstance(bears.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, snuffOut.id, "p1", [{ type: "permanent", id: "v" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });

    it("can't be regenerated — a regeneration shield does not save the creature", () => {
        const victim = makeInstance(bears.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, snuffOut.id, "p1", [{ type: "permanent", id: "v" }]);
        resolveTopOfStack(state);
        // CR 701.15c — the shield is bypassed; the creature is destroyed anyway.
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});
