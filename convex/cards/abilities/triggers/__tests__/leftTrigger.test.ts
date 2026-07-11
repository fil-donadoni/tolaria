// leftTrigger factory tests (CR 603.10) — the `causedByOpponent` condition
// helper (issue #1054). Card-level end-to-end coverage (destroy path emitting
// causerControllerId, full trigger + resolution) lives in the Karmic Justice /
// Sacred Ground describe blocks (ody/__tests__/white.test.ts,
// sth/__tests__/white.test.ts).

import { describe, expect, it } from "vitest";
import { causedByOpponent } from "../leftTrigger";
import type { CardType, PermanentLeftEvent, PermanentView } from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<PermanentLeftEvent> = {}
): PermanentLeftEvent {
    return {
        type: "PERMANENT_LEFT",
        instanceId: "victim",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Land"] as CardType[],
        wasAura: false,
        toZone: "graveyard",
        ...overrides,
    };
}

describe("causedByOpponent (issue #1054)", () => {
    it("is false when causerControllerId is undefined (no resolving causer — an SBA sweep)", () => {
        const self = makeSelf({ controllerId: "p1" });
        expect(causedByOpponent(makeEvent(), self)).toBe(false);
    });

    it("is false when the causer is the trigger's OWN controller (a player's own destroy/sacrifice of their own permanent)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({ causerControllerId: "p1" });
        expect(causedByOpponent(event, self)).toBe(false);
    });

    it("is true when the causer differs from the trigger's controller (an opponent's spell/ability)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({ causerControllerId: "p2" });
        expect(causedByOpponent(event, self)).toBe(true);
    });
});
