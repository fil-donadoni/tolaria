// tapPermanent is the single tap choke point (CR 701.26a): a real
// untapped → tapped transition queues exactly one PERMANENT_TAPPED, a
// non-transition queues none (issue #3787).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { tapPermanent, emitPermanentTapped } from "../state";

const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function setup() {
    const bear = makeInstance(BEARS, { id: "bear" });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")],
    });
    return { state, bear };
}

const tapEvents = (state: ReturnType<typeof setup>["state"]) =>
    (state.pendingEvents ?? []).filter((e) => e.type === "PERMANENT_TAPPED");

describe("tapPermanent emits PERMANENT_TAPPED (CR 701.26a)", () => {
    it("queues exactly one non-mana event on a real transition", () => {
        const { state, bear } = setup();
        expect(tapPermanent(state, bear)).toBe(true);
        expect(bear.isTapped).toBe(true);
        expect(tapEvents(state)).toEqual([
            expect.objectContaining({
                permanentId: "bear",
                controllerId: "p1",
                forMana: false,
            }),
        ]);
    });

    it("queues nothing on an already-tapped permanent", () => {
        const { state, bear } = setup();
        bear.isTapped = true;
        expect(tapPermanent(state, bear)).toBe(false);
        expect(tapEvents(state)).toHaveLength(0);
    });

    it("queues nothing twice for a second tap of the same permanent", () => {
        const { state, bear } = setup();
        tapPermanent(state, bear);
        tapPermanent(state, bear);
        expect(tapEvents(state)).toHaveLength(1);
    });

    it("mana taps that emit themselves stay at exactly one event", () => {
        const { state, bear } = setup();
        bear.isTapped = true;
        emitPermanentTapped(state, bear, true, { G: 1 });
        expect(tapEvents(state)).toHaveLength(1);
    });
});
