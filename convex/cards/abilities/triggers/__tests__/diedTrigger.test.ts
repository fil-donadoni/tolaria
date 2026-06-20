// Direct unit tests for the `diedTrigger` factory and the shared
// permanent-scope resolver. Exercises the scope vocabulary, filter wiring,
// CR 603.4 `condition`, CR 603.4d `interveningIf`, and the LKI payload
// handed to the resolve callback.

import { describe, expect, it, vi } from "vitest";
import { diedTrigger } from "../diedTrigger";
import { matchesPermanentScope } from "../shared";
import type {
    CardType,
    CreatureDiedEvent,
    PermanentView,
    SpellContext,
} from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<CreatureDiedEvent> = {}
): CreatureDiedEvent {
    return {
        type: "CREATURE_DIED",
        creatureInstanceId: "dead",
        creatureControllerId: "p2",
        creatureTypes: ["Creature"] as CardType[],
        damagedBySources: [],
        creaturePower: 2,
        creatureToughness: 2,
        ...overrides,
    };
}

describe("matchesPermanentScope (CR 109.2 / 109.4)", () => {
    const self = makeSelf({ id: "self", controllerId: "p1" });

    it("'self' matches only the source's own instance", () => {
        expect(
            matchesPermanentScope(
                "self",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "self",
                { instanceId: "other", controllerId: "p1" },
                self
            )
        ).toBe(false);
    });

    it("'yours' matches by controller equality", () => {
        expect(
            matchesPermanentScope(
                "yours",
                { instanceId: "x", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "yours",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(false);
    });

    it("'opponents' matches by controller inequality", () => {
        expect(
            matchesPermanentScope(
                "opponents",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "opponents",
                { instanceId: "x", controllerId: "p1" },
                self
            )
        ).toBe(false);
    });

    it("'any' always matches", () => {
        expect(
            matchesPermanentScope(
                "any",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "any",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
    });

    it("'another-yours' enforces same-controller AND self-exclusion (CR 109.2)", () => {
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(false);
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "ally", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "ally", controllerId: "p2" },
                self
            )
        ).toBe(false);
    });

    it("'any-other' enforces self-exclusion only (CR 109.2)", () => {
        expect(
            matchesPermanentScope(
                "any-other",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(false);
        expect(
            matchesPermanentScope(
                "any-other",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
    });
});

describe("diedTrigger factory", () => {
    it("declares CREATURE_DIED as the event type", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => {},
        });
        expect(ability.event).toBe("CREATURE_DIED");
    });

    it("rejects events of other types via the type guard", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => {},
        });
        const phaseEvent = {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        };
        expect(ability.matches(phaseEvent, makeSelf())).toBe(false);
    });

    it("filters by PermanentFilter.types using the LKI snapshot", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            filter: { types: "Creature" },
            resolve: () => {},
        });
        expect(
            ability.matches(
                makeEvent({ creatureTypes: ["Creature"] }),
                makeSelf()
            )
        ).toBe(true);
        expect(
            ability.matches(
                makeEvent({ creatureTypes: ["Artifact"] as CardType[] }),
                makeSelf()
            )
        ).toBe(false);
    });

    it("respects `condition` (CR 603.4) and short-circuits on false", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            condition: (event) => event.damagedBySources.includes("self"),
            resolve: () => {},
        });
        expect(
            ability.matches(makeEvent({ damagedBySources: [] }), makeSelf())
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent({ damagedBySources: ["self"] }),
                makeSelf()
            )
        ).toBe(true);
    });

    it("forwards `interveningIf` to the engine-level field (CR 603.4d)", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            interveningIf: (event) => event.creaturePower >= 3,
            resolve: () => {},
        });
        expect(ability.interveningIf).toBeDefined();
        expect(
            ability.interveningIf!(makeEvent({ creaturePower: 2 }), makeSelf())
        ).toBe(false);
        expect(
            ability.interveningIf!(makeEvent({ creaturePower: 4 }), makeSelf())
        ).toBe(true);
    });

    it("delivers a flattened LKI payload (CR 603.10) to `resolve`", () => {
        const seen = vi.fn();
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: (_ctx, _event, dead) => seen(dead),
        });
        const event = makeEvent({
            creatureInstanceId: "victim",
            creatureControllerId: "p2",
            creatureTypes: ["Creature", "Artifact"] as CardType[],
            damagedBySources: ["src"],
            creaturePower: 7,
            creatureToughness: 3,
        });
        ability.resolve!({} as SpellContext, event);
        expect(seen).toHaveBeenCalledWith({
            id: "victim",
            controllerId: "p2",
            types: ["Creature", "Artifact"],
            lastKnownPower: 7,
            lastKnownToughness: 3,
            damagedBySources: ["src"],
            combatPartnerIds: [],
        });
    });

    it("surfaces combatPartnerIds from the event (CR 603.10, Abu Ja'far)", () => {
        const seen = vi.fn();
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: (_ctx, _event, dead) => seen(dead.combatPartnerIds),
        });
        ability.resolve!(
            {} as SpellContext,
            makeEvent({ combatPartnerIds: ["a", "b"] })
        );
        expect(seen).toHaveBeenCalledWith(["a", "b"]);
    });

    it("'self' scope fires on the source's own death (CR 603.10 LKI host)", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "self",
            resolve: () => {},
        });
        const self = makeSelf({ id: "self" });
        expect(
            ability.matches(makeEvent({ creatureInstanceId: "self" }), self)
        ).toBe(true);
        expect(
            ability.matches(makeEvent({ creatureInstanceId: "other" }), self)
        ).toBe(false);
    });
});
