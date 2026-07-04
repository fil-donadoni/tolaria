// Mirage (MIR) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { lionsEyeDiamond } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

// Lion's Eye Diamond — "Discard your hand, Sacrifice this artifact: Add
// three mana of any one color. Activate only as an instant." "Discard your
// hand" is expressed via the existing `discardAtRandom` cost primitive with
// a count comfortably above any reachable hand size — clamped to the actual
// hand size (CR 118.3), so every card discards regardless of hand size.
describe("Lion's Eye Diamond ({T}, Sacrifice, discard hand: 3 of one color, CR 118.3 / 605.1a)", () => {
    it("is a {0} artifact whose cost discards the whole hand and sacrifices itself", () => {
        expect(lionsEyeDiamond.manaCost).toEqual({});
        expect(lionsEyeDiamond.types).toEqual(["Artifact"]);
        const ability = lionsEyeDiamond.activatedAbilities![0];
        expect(ability.cost.sacrifice).toBe(true);
        // A count safely above any reachable hand size — the primitive
        // clamps to the actual hand, so this always discards everything.
        expect(ability.cost.discardAtRandom).toBeGreaterThanOrEqual(99);
        expect(ability.useStack).toBe(false);
    });

    it("offers 3 mana of any ONE color (not 1 mana of any color x3)", () => {
        const ability = lionsEyeDiamond.activatedAbilities![0];
        expect(ability.manaChoices).toEqual([
            { W: 3 },
            { U: 3 },
            { B: 3 },
            { R: 3 },
            { G: 3 },
        ]);
    });

    // Full path through the real tap-for-mana entry point
    // (`tapSourceIntoPayment` — the choice branch, since LED has no {T} cost
    // but a `manaChoices`-shaped mana ability). Exercises the discard-at-
    // random cost (`payDiscardAtRandomCost`, wired for tap mana abilities via
    // the new `applyManaAbilityDiscardCost` rider) together with the
    // sacrifice and the mana production, from ONE activation.
    it("discards the whole hand, sacrifices the diamond, and adds 3 mana of one color (CR 118.3 / 605.1a / 701.16)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
        ];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        // Index 2 = {B}: 3 mana of one color.
        tapSourceIntoPayment(state, player, led, 2, []);
        expect(player.manaPool.B).toBe(3);
        // Whole hand discarded — the `discardAtRandom: 99` primitive clamps
        // to the actual hand size (4), so the hand ends empty, not partially
        // discarded.
        expect(player.hand).toHaveLength(0);
        expect(player.graveyard).toHaveLength(4 + 1); // 4 discarded + LED itself
        // Sacrificed: off the battlefield.
        expect(player.battlefield.find((c) => c.id === "led")).toBeUndefined();
        expect(player.graveyard.find((c) => c.id === "led")).toBeDefined();
    });

    it("with a smaller hand, discards exactly what's there (clamped, not an error)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" })];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, led, 0, []); // index 0 = {W}
        expect(player.manaPool.W).toBe(3);
        expect(player.hand).toHaveLength(0);
    });

    it("the emptied hand and the produced mana survive the wire-format projection (PublicGameState)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
        ];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, led, 4, []); // index 4 = {G}
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.G).toBe(3);
        expect(projected.players[0].hand).toHaveLength(0);
        expect(
            projected.players[0].battlefield.find((c) => c.id === "led")
        ).toBeUndefined();
    });
});
