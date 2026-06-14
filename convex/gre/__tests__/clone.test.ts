// Structural-sharing clone (ADR 0001, issue #108 — vs-AI feasibility slice).
import { describe, expect, it } from "vitest";
import { cloneGameState } from "../clone";
import { advancePhase } from "../phases";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import type { GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id;

function representativeState(): GameState {
    const p1 = makePlayer("p1", {
        battlefield: [
            makeInstance(BEARS, { id: "bear-1", controllerId: "p1" }),
        ],
        hand: [makeInstance(BEARS, { id: "bear-h", zone: "hand" })],
        library: Array.from({ length: 10 }, (_, i) =>
            makeInstance(BEARS, { id: `lib-${i}`, zone: "library" })
        ),
    });
    const p2 = makePlayer("p2");
    return makeState({ players: [p1, p2] });
}

describe("cloneGameState (structural sharing, issue #108)", () => {
    it("produces an independent copy of mutable paths", () => {
        const state = representativeState();
        const clone = cloneGameState(state);

        expect(clone).not.toBe(state);
        expect(clone.players).not.toBe(state.players);
        expect(clone.players[0].battlefield).not.toBe(
            state.players[0].battlefield
        );
        expect(clone.players[0].battlefield[0]).not.toBe(
            state.players[0].battlefield[0]
        );
        // value-equal despite different identity
        expect(clone).toEqual(state);
    });

    it("shares the immutable card-definition reference by identity", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        expect(clone.players[0].battlefield[0].card).toBe(
            state.players[0].battlefield[0].card
        );
    });

    it("deep-copies mutable nested collections (types/counters)", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        const orig = state.players[0].battlefield[0];
        const copy = clone.players[0].battlefield[0];
        expect(copy.types).not.toBe(orig.types);
        expect(copy.staticAbilities).not.toBe(orig.staticAbilities);
    });

    it("mutating the clone in place never reaches the original", () => {
        const state = representativeState();
        const clone = cloneGameState(state);

        const copy = clone.players[0].battlefield[0];
        copy.isTapped = true;
        copy.power = 99;
        copy.types.push("Artifact");
        copy.counters = { "+1/+1": 3 };
        clone.players[0].life = 1;
        clone.players[0].battlefield.push(makeInstance(BEARS, { id: "added" }));

        const origCard = state.players[0].battlefield[0];
        expect(origCard.isTapped).toBe(false);
        expect(origCard.power).toBe(2);
        expect(origCard.types).not.toContain("Artifact");
        expect(origCard.counters).toBeUndefined();
        expect(state.players[0].life).toBe(20);
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("survives a real in-place engine move (advancePhase) without aliasing", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        const phaseBefore = state.phase;

        advancePhase(clone);

        // engine mutated the clone, not the original
        expect(state.phase).toBe(phaseBefore);
        expect(clone.phase).not.toBe(phaseBefore);
    });
});
