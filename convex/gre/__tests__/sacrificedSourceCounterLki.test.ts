// CR 608.2h / 122.2 — a source sacrificed as an activation cost answers "the
// number of counters on it" with its last known information. The departure
// deletes the live `counters` and keeps them as `countersAtLeave`; the stack
// item is cloned from the source after the cost is paid, so it carries the
// departure snapshot only. Driven through the real activation commit
// (`activateAbilityOnState`), never a hand-built stack item, because the
// hand-built one is cloned before the departure and hides the gap.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack } from "../state";
import { activateAbilityOnState } from "../../game";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const KEG = getDefinition("4d9715c2-9036-4ae2-a5b4-1b190d50c963").id;
const BEARS = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095").id; // vanilla 2/2
const DETONATE = "powder-keg-detonate";

function kegBoard(fuse: number) {
    const keg = makeInstance(KEG, {
        id: "keg",
        controllerId: "p1",
        ownerId: "p1",
        counters: { fuse },
    });
    const bears = makeInstance(BEARS, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [keg] }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
    });
}

function detonate(fuse: number) {
    const state = kegBoard(fuse);
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "keg",
        abilityId: DETONATE,
    });
    expect(state.players[0].battlefield.some((c) => c.id === "keg")).toBe(
        false
    );
    expect(state.stack).toHaveLength(1);
    resolveTopOfStack(state);
    return state.players[1].battlefield.some((c) => c.id === "bears");
}

describe("sacrificed source counter count (CR 608.2h, CR 122.2)", () => {
    it("reads the fuse counters the Keg had when it was sacrificed", () => {
        // Two fuse counters: the mana value 2 Bears is destroyed.
        expect(detonate(2)).toBe(false);
    });

    it("a count that does not match leaves the Bears alone", () => {
        // Three fuse counters: mana value 2 survives.
        expect(detonate(3)).toBe(true);
    });
});
