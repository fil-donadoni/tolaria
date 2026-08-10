// Unit tests for the `leftTrigger` factory (CR 603.10).
//
// Exercises external behavior of the returned `TriggeredAbility` — `matches`
// gating across scope / toZone / filter / condition, and the engine-facing
// `interveningIf` re-evaluation hook. The `resolve` callback receives the
// last-known-info payload — exercised here by capturing the third argument.
//
// End-to-end coverage against real cards lives in
// `convex/cards/sets/__tests__/lea.test.ts` (Animate Dead, Personal
// Incarnation, Lich). These tests are intentionally pure-fixture so factory
// regressions surface without engine entanglement.

import { describe, expect, it } from "vitest";
import { leftTrigger } from "../triggers/leftTrigger";
import type { GameEvent, PermanentLeftEvent, PermanentView } from "../../types";

function selfView(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self-1",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"],
        subtypes: ["Aura"],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function leftEvent(
    overrides: Partial<PermanentLeftEvent> = {}
): PermanentLeftEvent {
    return {
        type: "PERMANENT_LEFT",
        instanceId: "self-1",
        controllerId: "p1",
        ownerId: "p1",
        cardId: "card-1",
        types: ["Creature"],
        wasAura: false,
        toZone: "graveyard",
        ...overrides,
    };
}

describe("leftTrigger.matches — scope", () => {
    it('"self" matches only the source itself', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ instanceId: "self-1" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ instanceId: "other" }), self)).toBe(
            false
        );
    });

    it('"yours" matches any permanent whose controller equals source\'s controller', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "yours",
            resolve: () => {},
        });
        const self = selfView({ id: "self", controllerId: "p1" });
        expect(
            ability.matches(
                leftEvent({ instanceId: "x", controllerId: "p1" }),
                self
            )
        ).toBe(true);
        expect(
            ability.matches(
                leftEvent({ instanceId: "x", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it('"opponents" matches permanents with a different controller than source', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "opponents",
            resolve: () => {},
        });
        const self = selfView({ controllerId: "p1" });
        expect(ability.matches(leftEvent({ controllerId: "p2" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ controllerId: "p1" }), self)).toBe(
            false
        );
    });

    it('"any" matches every leaving permanent', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "any",
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ controllerId: "p2" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ controllerId: "p1" }), self)).toBe(
            true
        );
    });

    it('"another-yours" excludes the source even when controller matches (CR 109.2)', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "another-yours",
            resolve: () => {},
        });
        const self = selfView({ id: "self", controllerId: "p1" });
        expect(
            ability.matches(
                leftEvent({ instanceId: "self", controllerId: "p1" }),
                self
            )
        ).toBe(false);
        expect(
            ability.matches(
                leftEvent({ instanceId: "other", controllerId: "p1" }),
                self
            )
        ).toBe(true);
        expect(
            ability.matches(
                leftEvent({ instanceId: "other", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it('"any-other" matches anything except the source itself', () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "any-other",
            resolve: () => {},
        });
        const self = selfView({ id: "self" });
        expect(ability.matches(leftEvent({ instanceId: "self" }), self)).toBe(
            false
        );
        expect(ability.matches(leftEvent({ instanceId: "x" }), self)).toBe(
            true
        );
    });
});

describe("leftTrigger.matches — toZone", () => {
    it("omitted matches any exit zone", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            resolve: () => {},
        });
        const self = selfView();
        for (const z of ["graveyard", "exile", "hand", "library"] as const) {
            expect(ability.matches(leftEvent({ toZone: z }), self)).toBe(true);
        }
    });

    it("single zone narrows to that destination", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            toZone: "graveyard",
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ toZone: "graveyard" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ toZone: "exile" }), self)).toBe(
            false
        );
    });

    it("array narrows to a set of destinations", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            toZone: ["graveyard", "exile"],
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ toZone: "graveyard" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ toZone: "exile" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ toZone: "hand" }), self)).toBe(
            false
        );
    });
});

describe("leftTrigger.matches — filter", () => {
    it("gates by leaving permanent's types", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "any",
            filter: { types: "Creature" },
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ types: ["Creature"] }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ types: ["Artifact"] }), self)).toBe(
            false
        );
    });

    it("filter controllerRelation reads the source's controller", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "any",
            filter: { controllerRelation: "you" },
            resolve: () => {},
        });
        const self = selfView({ controllerId: "p1" });
        expect(ability.matches(leftEvent({ controllerId: "p1" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ controllerId: "p2" }), self)).toBe(
            false
        );
    });
});

describe("leftTrigger.matches — condition (CR 603.4)", () => {
    it("blocks firing when condition returns false", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            condition: (event) => event.toZone === "graveyard",
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.matches(leftEvent({ toZone: "graveyard" }), self)).toBe(
            true
        );
        expect(ability.matches(leftEvent({ toZone: "exile" }), self)).toBe(
            false
        );
    });
});

describe("leftTrigger — interveningIf wrapper (CR 603.4)", () => {
    it("forwards the narrowed event to the author predicate", () => {
        let seen: PermanentLeftEvent | undefined;
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            interveningIf: (event) => {
                seen = event;
                return event.toZone === "graveyard";
            },
            resolve: () => {},
        });
        const self = selfView();
        expect(ability.interveningIf).toBeDefined();
        expect(
            ability.interveningIf!(leftEvent({ toZone: "graveyard" }), self)
        ).toBe(true);
        expect(seen?.type).toBe("PERMANENT_LEFT");
        expect(
            ability.interveningIf!(leftEvent({ toZone: "exile" }), self)
        ).toBe(false);
    });

    it("returns false for non-PERMANENT_LEFT events without invoking the predicate", () => {
        let calls = 0;
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            interveningIf: () => {
                calls += 1;
                return true;
            },
            resolve: () => {},
        });
        const phaseEvent: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        };
        expect(ability.interveningIf!(phaseEvent, selfView())).toBe(false);
        expect(calls).toBe(0);
    });

    it("is omitted entirely when the author did not pass one", () => {
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            resolve: () => {},
        });
        expect(ability.interveningIf).toBeUndefined();
    });
});

describe("leftTrigger — resolve payload (CR 603.10 last-known-info)", () => {
    it("forwards a leaving snapshot with attachedToBeforeLeave and toZone", () => {
        const seen: Array<{
            id: string;
            controllerId: string;
            ownerId: string;
            types: readonly string[];
            toZone: string;
            attachedToBeforeLeave?: string;
        }> = [];
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            resolve: (_ctx, _event, leaving) => {
                seen.push({ ...leaving });
            },
        });
        // SpellContext stub — leftTrigger.resolve does not read it before the
        // factory forwards to the author resolve, so a bare cast is fine.
        const fakeCtx = {} as Parameters<
            NonNullable<typeof ability.resolve>
        >[0];
        ability.resolve!(
            fakeCtx,
            leftEvent({
                instanceId: "aura-1",
                controllerId: "p2",
                ownerId: "p3",
                toZone: "exile",
                attachedToBeforeLeave: "host-1",
                types: ["Enchantment"],
            })
        );
        expect(seen).toEqual([
            {
                id: "aura-1",
                controllerId: "p2",
                ownerId: "p3",
                types: ["Enchantment"],
                toZone: "exile",
                attachedToBeforeLeave: "host-1",
            },
        ]);
    });

    it("is a no-op for non-PERMANENT_LEFT events", () => {
        let calls = 0;
        const ability = leftTrigger({
            id: "t",
            oracleText: "",
            scope: "self",
            resolve: () => {
                calls += 1;
            },
        });
        const fakeCtx = {} as Parameters<
            NonNullable<typeof ability.resolve>
        >[0];
        ability.resolve!(fakeCtx, {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        });
        expect(calls).toBe(0);
    });
});
