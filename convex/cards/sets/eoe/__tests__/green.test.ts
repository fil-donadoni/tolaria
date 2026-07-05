// EOE — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { ouroboroid } from "../green";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Ouroboroid — {2}{G}{G} Creature — Plant Wurm, 1/3 (CR 603.6a beginning-of-
// combat trigger; CR 122 counter placement; CR 608.2i X determined once).
// "At the beginning of combat on your turn, put X +1/+1 counters on each
// creature you control, where X is this creature's power."
describe("Ouroboroid (CR 603.6a beginning-of-combat trigger; CR 122 mass counters, X = source power)", () => {
    function setup(otherPower = 2, otherToughness = 2) {
        const ouro = makeInstance(ouroboroid.id, {
            id: "ouro",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A plain vanilla creature — NOT another Ouroboroid, so its own
        // beginning-of-combat trigger doesn't also fire and double the count.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            power: otherPower,
            toughness: otherToughness,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [ouro, other] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        return { state, ouro, other };
    }

    it("shape: 1/3 for {2}{G}{G} with the beginning-of-combat trigger declared", () => {
        expect(ouroboroid.manaCost).toEqual({ X: 2, G: 2 });
        expect(ouroboroid.power).toBe(1);
        expect(ouroboroid.toughness).toBe(3);
        expect(ouroboroid.triggeredAbilities).toHaveLength(1);
    });

    it("puts X (its own power, 1) +1/+1 counters on EACH creature you control, including itself", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const ouroLive = state.players[0].battlefield.find(
            (c) => c.id === "ouro"
        )!;
        const otherLive = state.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(ouroLive.counters?.["+1/+1"]).toBe(1);
        expect(otherLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, ouroLive)).toBe(2);
        expect(getEffectivePower(state, otherLive)).toBe(3);
    });

    it("does NOT put counters on an opponent's creature", () => {
        const { state, ouro } = setup();
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players.push(makePlayer("p2", { battlefield: [oppCreature] }));
        state.players[0].battlefield = [ouro];
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const oppLive = state.players[1].battlefield.find(
            (c) => c.id === "opp"
        )!;
        expect(oppLive.counters?.["+1/+1"]).toBeUndefined();
    });

    it("wire format: the mass +1/+1 counters survive projectPublicState", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const otherLive = projected.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(getEffectivePower(projected, otherLive)).toBe(3);
    });
});
