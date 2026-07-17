// leftTrigger factory tests (CR 603.10) — the `causedByOpponent` condition
// helper (issue #1054). Card-level end-to-end coverage (destroy path emitting
// causerControllerId, full trigger + resolution) lives in the Karmic Justice /
// Sacred Ground describe blocks (ody/__tests__/white.test.ts,
// sth/__tests__/white.test.ts).

import { describe, expect, it } from "vitest";
import { causedByOpponent, leftTrigger, wasSacrificed } from "../leftTrigger";
import type {
    CardType,
    PermanentLeftEvent,
    PermanentView,
} from "../../../types";

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

describe("wasSacrificed (CR 701.16, issue #1191)", () => {
    it("is true when cause is 'sacrifice'", () => {
        expect(wasSacrificed(makeEvent({ cause: "sacrifice" }))).toBe(true);
    });

    it("is false when cause is 'destroy' (CR 701.8)", () => {
        expect(wasSacrificed(makeEvent({ cause: "destroy" }))).toBe(false);
    });

    it("is false when cause is undefined (bounce, mill, an automatic SBA sweep)", () => {
        expect(wasSacrificed(makeEvent())).toBe(false);
    });
});

describe("leftTrigger subtype filter (CR 205.3, issue #1191)", () => {
    const ability = leftTrigger({
        id: "sac-clue-counter",
        oracleText:
            "Whenever you sacrifice a Clue, put a +1/+1 counter on this creature.",
        scope: "yours",
        toZone: "graveyard",
        filter: { subtypes: "Clue" },
        condition: (event) => wasSacrificed(event),
        resolve: () => {},
    });

    it("fires when the leaving permanent's subtypes match the filter and it was sacrificed", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({
            controllerId: "p1",
            subtypes: ["Clue"],
            toZone: "graveyard",
            cause: "sacrifice",
        });
        expect(ability.matches(event, self)).toBe(true);
    });

    it("does not fire when the leaving permanent's subtypes don't match (a sacrificed Treasure, not a Clue)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({
            controllerId: "p1",
            subtypes: ["Treasure"],
            toZone: "graveyard",
            cause: "sacrifice",
        });
        expect(ability.matches(event, self)).toBe(false);
    });

    it("does not fire when the departure wasn't a sacrifice (a destroyed Clue)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({
            controllerId: "p1",
            subtypes: ["Clue"],
            toZone: "graveyard",
            cause: "destroy",
        });
        expect(ability.matches(event, self)).toBe(false);
    });

    it("does not fire for an opponent's sacrificed Clue (scope: yours)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({
            controllerId: "p2",
            subtypes: ["Clue"],
            toZone: "graveyard",
            cause: "sacrifice",
        });
        expect(ability.matches(event, self)).toBe(false);
    });

    it("fails closed when the event carries no subtypes (older fixtures / serialized logs)", () => {
        const self = makeSelf({ controllerId: "p1" });
        const event = makeEvent({
            controllerId: "p1",
            toZone: "graveyard",
            cause: "sacrifice",
        });
        expect(event.subtypes).toBeUndefined();
        expect(ability.matches(event, self)).toBe(false);
    });
});

describe("leftTrigger DSL support (ADR 0045, issue #1191)", () => {
    it("builds an effects[]-based ability when `effects` is given (no `resolve`)", () => {
        const ability = leftTrigger({
            id: "dsl-ability",
            oracleText: "test",
            scope: "yours",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        });
        expect(ability.effects).toHaveLength(1);
        expect(ability.resolve).toBeUndefined();
    });

    it("builds a resolve-based ability when `resolve` is given (no `effects`)", () => {
        const ability = leftTrigger({
            id: "resolve-ability",
            oracleText: "test",
            scope: "yours",
            resolve: () => {},
        });
        expect(ability.resolve).toBeDefined();
        expect(ability.effects).toBeUndefined();
    });

    it("throws when neither `effects` nor `resolve` is given", () => {
        expect(() =>
            leftTrigger({
                id: "broken-ability",
                oracleText: "test",
                scope: "yours",
            } as Parameters<typeof leftTrigger>[0])
        ).toThrow(/effects\[\] or resolve/);
    });
});
