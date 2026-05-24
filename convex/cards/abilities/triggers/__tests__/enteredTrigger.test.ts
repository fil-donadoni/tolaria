// Direct unit tests for the `enteredTrigger` factory. Exercises the scope
// vocabulary, filter wiring, CR 603.4 `condition`, CR 603.4d `interveningIf`,
// and the flattened payload handed to the resolve callback. The shared
// `matchesPermanentScope` helper is covered by `diedTrigger.test.ts`; this
// file focuses on entered-specific wiring (event-type narrowing and the
// PERMANENT_ENTERED payload field mapping).

import { describe, expect, it, vi } from "vitest";
import { enteredTrigger } from "../enteredTrigger";
import type {
    CardType,
    PermanentEnteredEvent,
    PermanentView,
    SpellContext,
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
    overrides: Partial<PermanentEnteredEvent> = {}
): PermanentEnteredEvent {
    return {
        type: "PERMANENT_ENTERED",
        instanceId: "entrant",
        controllerId: "p1",
        types: ["Creature"] as CardType[],
        ...overrides,
    };
}

describe("enteredTrigger factory", () => {
    it("declares PERMANENT_ENTERED as the event type", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => {},
        });
        expect(ability.event).toBe("PERMANENT_ENTERED");
    });

    it("rejects events of other types via the type guard", () => {
        const ability = enteredTrigger({
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

    it("'self' scope fires on the source's own ETB (CR 603.6a)", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "self",
            resolve: () => {},
        });
        const self = makeSelf({ id: "self" });
        expect(ability.matches(makeEvent({ instanceId: "self" }), self)).toBe(
            true
        );
        expect(ability.matches(makeEvent({ instanceId: "other" }), self)).toBe(
            false
        );
    });

    it("'yours' scope fires only when entering permanent shares controller", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "yours",
            resolve: () => {},
        });
        const self = makeSelf({ controllerId: "p1" });
        expect(
            ability.matches(
                makeEvent({ instanceId: "other", controllerId: "p1" }),
                self
            )
        ).toBe(true);
        expect(
            ability.matches(
                makeEvent({ instanceId: "other", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it("'another-yours' excludes the source itself (CR 109.2)", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "another-yours",
            resolve: () => {},
        });
        const self = makeSelf({ id: "self", controllerId: "p1" });
        expect(
            ability.matches(
                makeEvent({ instanceId: "self", controllerId: "p1" }),
                self
            )
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent({ instanceId: "ally", controllerId: "p1" }),
                self
            )
        ).toBe(true);
    });

    it("filters by PermanentFilter.types using the event snapshot", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            filter: { types: "Creature" },
            resolve: () => {},
        });
        expect(
            ability.matches(makeEvent({ types: ["Creature"] }), makeSelf())
        ).toBe(true);
        expect(
            ability.matches(
                makeEvent({ types: ["Artifact"] as CardType[] }),
                makeSelf()
            )
        ).toBe(false);
    });

    it("filter applies controllerRelation against the entering permanent", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            filter: { controllerRelation: "you" },
            resolve: () => {},
        });
        const self = makeSelf({ controllerId: "p1" });
        expect(
            ability.matches(
                makeEvent({ instanceId: "x", controllerId: "p1" }),
                self
            )
        ).toBe(true);
        expect(
            ability.matches(
                makeEvent({ instanceId: "x", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it("respects `condition` (CR 603.4) and short-circuits on false", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            condition: (event) => event.controllerId === "p2",
            resolve: () => {},
        });
        expect(
            ability.matches(makeEvent({ controllerId: "p1" }), makeSelf())
        ).toBe(false);
        expect(
            ability.matches(makeEvent({ controllerId: "p2" }), makeSelf())
        ).toBe(true);
    });

    it("forwards `interveningIf` to the engine-level field (CR 603.4d)", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            interveningIf: (event) => event.controllerId === "p1",
            resolve: () => {},
        });
        expect(ability.interveningIf).toBeDefined();
        expect(
            ability.interveningIf!(
                makeEvent({ controllerId: "p2" }),
                makeSelf()
            )
        ).toBe(false);
        expect(
            ability.interveningIf!(
                makeEvent({ controllerId: "p1" }),
                makeSelf()
            )
        ).toBe(true);
    });

    it("interveningIf ignores non-PERMANENT_ENTERED events", () => {
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            interveningIf: () => true,
            resolve: () => {},
        });
        const phaseEvent = {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        };
        expect(ability.interveningIf!(phaseEvent, makeSelf())).toBe(false);
    });

    it("delivers a flattened payload (CR 603.6a) to `resolve`", () => {
        const seen = vi.fn();
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: (_ctx, _event, entered) => seen(entered),
        });
        const event = makeEvent({
            instanceId: "newbie",
            controllerId: "p2",
            types: ["Creature", "Artifact"] as CardType[],
        });
        ability.resolve({} as SpellContext, event);
        expect(seen).toHaveBeenCalledWith({
            id: "newbie",
            controllerId: "p2",
            types: ["Creature", "Artifact"],
        });
    });

    it("resolve is a no-op on non-PERMANENT_ENTERED events", () => {
        const seen = vi.fn();
        const ability = enteredTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => seen(),
        });
        const phaseEvent = {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        };
        ability.resolve({} as SpellContext, phaseEvent);
        expect(seen).not.toHaveBeenCalled();
    });
});
