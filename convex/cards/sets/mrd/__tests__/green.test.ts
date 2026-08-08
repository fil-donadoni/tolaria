// mrd (Mirrodin) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { viridianJoiner } from "../green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getDynamicManaProduced,
    getFixedManaAmount,
} from "../../../../gre/constants";
import { tapSourceIntoPayment } from "../../../../game";
import type { GameState, CardInstanceState } from "../../../../gre/state";

// Viridian Joiner — "{T}: Add an amount of {G} equal to this creature's
// power." A board-conditional, single-colour mana ability (CR 106.1 /
// 605.1a) whose amount is the source's OWN power. This is the shipping
// regression test for issue #927: `manaAmount` must read the source's
// CURRENT EFFECTIVE power (CR 613.4 layer pipeline — +1/+1 counters here),
// not the raw base `CardInstanceState.power`, so mana output tracks the
// creature as it grows.
describe("Viridian Joiner (board-conditional mana from own EFFECTIVE power, CR 106.1 / 605.1a / 613.4)", () => {
    it("at base power (no counters), taps for exactly {G} (CR 106.1)", () => {
        const joiner = makeInstance(viridianJoiner.id);
        const battlefield = [joiner];
        expect(getDynamicManaProduced(joiner, battlefield)).toEqual({ G: 1 });
        expect(getFixedManaAmount(joiner, "G", battlefield)).toBe(1);
    });

    it("+1/+1 counters raise the mana output (CR 613.4 layer 7d, issue #927)", () => {
        const joiner = makeInstance(viridianJoiner.id, {
            counters: { "+1/+1": 3 },
        });
        const battlefield = [joiner];
        // Base power 1 + 3 counters = effective power 4.
        expect(getDynamicManaProduced(joiner, battlefield)).toEqual({ G: 4 });
        expect(getFixedManaAmount(joiner, "G", battlefield)).toBe(4);
    });

    it("output recomputes live as counters are added mid-game", () => {
        const joiner = makeInstance(viridianJoiner.id, { id: "joiner" });
        const player = makePlayer("p1", { battlefield: [joiner] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        const card = state.players[0].battlefield[0];

        expect(
            getFixedManaAmount(card, "G", state.players[0].battlefield)
        ).toBe(1);
        card.counters = { "+1/+1": 2 };
        expect(
            getFixedManaAmount(card, "G", state.players[0].battlefield)
        ).toBe(3);

        tapSourceIntoPayment(state, state.players[0], card, undefined, []);
        expect(state.players[0].manaPool.G).toBe(3);
        expect(card.isTapped).toBe(true);
    });

    it("wire format: counter-driven power survives projectPublicState", () => {
        const joiner = makeInstance(viridianJoiner.id, {
            id: "joiner",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", { battlefield: [joiner] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "joiner"
        )! as CardInstanceState;
        const slimBattlefield = projected.players[0]
            .battlefield as CardInstanceState[];
        expect(getDynamicManaProduced(slim, slimBattlefield)).toEqual({
            G: 3,
        });
        expect(getFixedManaAmount(slim, "G", slimBattlefield)).toBe(3);
    });
});
