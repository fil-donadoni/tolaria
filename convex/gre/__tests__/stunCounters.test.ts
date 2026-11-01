// Stun counters — CR 122.1d (issue #2603). A permanent with a stun counter
// that would become untapped instead loses ONE stun counter and stays tapped.

import { describe, it, expect } from "vitest";
import { untapStep } from "../phases";
import { untapPermanent } from "../state";
import { compactState, expandState } from "../serialize";
import { makeInstance, makeState } from "../../cards/__tests__/setup.helper";

/** Grizzly Bears — any vanilla permanent will do. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function stunned(count: number, isTapped = true) {
    return makeInstance(BEARS, {
        id: "stunned",
        isTapped,
        counters: count > 0 ? { stun: count } : undefined,
    });
}

describe("stun counters (CR 122.1d)", () => {
    it("CR 122.1d — each untap step removes exactly one counter and the permanent stays tapped", () => {
        const card = stunned(3);
        const state = makeState({ phase: "UNTAP", activePlayerId: "p1" });
        state.players[0].battlefield = [card];
        untapStep(state);
        expect(card.isTapped).toBe(true);
        expect(card.counters?.stun).toBe(2);
    });

    it("CR 122.1d — removing the LAST counter does not untap that turn; the next untap does", () => {
        const card = stunned(1);
        const state = makeState({ phase: "UNTAP", activePlayerId: "p1" });
        state.players[0].battlefield = [card];
        untapStep(state);
        expect(card.isTapped).toBe(true);
        expect(card.counters).toBeUndefined();
        untapStep(state);
        expect(card.isTapped).toBe(false);
    });

    it("CR 122.1d — an untap from an effect (not the untap step) is replaced too", () => {
        const card = stunned(2);
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.players[0].battlefield = [card];
        expect(untapPermanent(state, card)).toBe(false);
        expect(card.isTapped).toBe(true);
        expect(card.counters?.stun).toBe(1);
        // Replaced untap emits no PERMANENT_UNTAPPED, only the counter removal.
        const types = (state.pendingEvents ?? []).map((e) => e.type);
        expect(types).toContain("COUNTER_REMOVED");
        expect(types).not.toContain("PERMANENT_UNTAPPED");
    });

    it("CR 122.1d — an already-untapped permanent with stun counters is unaffected", () => {
        const card = stunned(2, false);
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.players[0].battlefield = [card];
        expect(untapPermanent(state, card)).toBe(false);
        expect(card.counters?.stun).toBe(2);
        expect(state.pendingEvents ?? []).toHaveLength(0);
    });

    it("a permanent without stun counters untaps normally", () => {
        const card = stunned(0);
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.players[0].battlefield = [card];
        expect(untapPermanent(state, card)).toBe(true);
        expect(card.isTapped).toBe(false);
    });

    it("stun counts survive the serialization round-trip", () => {
        const card = stunned(6);
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.players[0].battlefield = [card];
        const back = expandState(compactState(state));
        expect(back.players[0].battlefield[0].counters?.stun).toBe(6);
    });
});
