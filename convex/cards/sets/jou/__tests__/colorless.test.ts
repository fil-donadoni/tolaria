// jou (Journey into Nyx) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { manaConfluence } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

// Mana Confluence — "{T}, Pay 1 life: Add one mana of any color." (CR 605.1a
// mana ability, CR 118.4 life payment cost.) Unlike the Talisman/painland
// cycle, EVERY colour choice costs the same flat 1 life (uniform `cost.life`,
// no per-choice damage rider) — a plain any-colour mana ability with a life
// tax on the whole activation.
describe("Mana Confluence ({T}, Pay 1 life: Add one mana of any color, CR 605.1a / 118.4)", () => {
    it("tapping for any colour costs 1 life and adds that colour", () => {
        const land = makeInstance(manaConfluence.id, {
            id: "conf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, land, 2, []); // index 2 = {B}
        expect(player.manaPool.B).toBe(1);
        expect(player.life).toBe(19);
    });

    it("the life loss survives the wire-format projection (PublicGameState)", () => {
        const land = makeInstance(manaConfluence.id, {
            id: "conf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, land, 0, []); // index 0 = {W}
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(19);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "conf"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});
