// The counter-clock creature valuation (CR 702.176a, issue #1970): an
// impending permanent is priced as the creature it will be, discounted like
// that creature in hand — never at its non-creature face's nothing, never at
// the full price of the creature it is not yet.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { counterClockTurns } from "../ai/counterClockCreature";
import { permanentRealisedValue } from "../evaluate";
import { syncLayers2to5 } from "../layers2to5";
import type { CardInstanceState, GameState } from "../state";

const OVERLORD = getCardByName("Overlord of the Balemurk").id;

function board(overlord: Partial<CardInstanceState>): {
    state: GameState;
    perm: CardInstanceState;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(OVERLORD, {
                        id: "overlord",
                        controllerId: "p1",
                        ownerId: "p1",
                        ...overlord,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    syncLayers2to5(state);
    return { state, perm: state.players[0].battlefield[0]! };
}

describe("counter-clock creature valuation (CR 702.176a)", () => {
    it("reads the clock off an impending permanent, and nothing off a creature", () => {
        expect(
            counterClockTurns(
                board({ impended: true, counters: { time: 5 } }).perm
            )
        ).toBe(5);
        expect(counterClockTurns(board({}).perm)).toBeNull();
        // Last counter gone: a creature again, off the clock.
        expect(
            counterClockTurns(
                board({ impended: true, counters: { time: 0 } }).perm
            )
        ).toBeNull();
    });

    it("prices the impending Overlord well above its non-creature face, and below the creature", () => {
        const impending = board({ impended: true, counters: { time: 5 } });
        const creature = board({});
        const clocked = permanentRealisedValue(impending.state, impending.perm);
        const hard = permanentRealisedValue(creature.state, creature.perm);
        expect(impending.perm.types).toEqual(["Enchantment"]);
        expect(clocked).toBeLessThan(hard);
        // The body is real: more than half the creature, not the near-zero
        // a non-creature reading of a vanilla-bodied card gives.
        expect(clocked).toBeGreaterThan(hard / 2);
    });
});
