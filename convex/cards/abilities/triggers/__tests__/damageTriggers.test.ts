// Unit tests for the damage trigger factories. Exercises the factory's
// `matches` predicate in isolation (no engine round-trip) so scope/filter
// permutations are cheap to assert. Migration-level / wire-format coverage
// lives in `convex/cards/sets/__tests__/lea.test.ts` per project convention.

import { describe, it, expect } from "vitest";
import type {
    DamageDealtEvent,
    GameEvent,
    PermanentView,
    TriggerStateView,
} from "../../../types";
import { damageDealtTrigger } from "../damageDealtTrigger";
import { damageTakenTrigger } from "../damageTakenTrigger";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self-1",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<DamageDealtEvent> = {}
): DamageDealtEvent {
    return {
        type: "DAMAGE_DEALT",
        sourceInstanceId: "src-1",
        sourceControllerId: "p1",
        target: { type: "player", id: "p2" },
        amount: 2,
        isCombat: true,
        sourceColors: ["R"],
        sourceTypes: ["Creature"],
        sourceSubtypes: [],
        sourceStaticAbilities: ["flying"],
        ...overrides,
    };
}

function makeView(): TriggerStateView {
    return {
        players: [
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [
                    {
                        id: "self-1",
                        controllerId: "p1",
                        ownerId: "p1",
                        types: ["Creature"],
                        subtypes: [],
                        staticAbilities: [],
                    },
                ],
            },
            {
                id: "p2",
                life: 15,
                hand: [],
                battlefield: [
                    {
                        id: "opp-1",
                        controllerId: "p2",
                        ownerId: "p2",
                        types: ["Creature"],
                        subtypes: [],
                        staticAbilities: [],
                    },
                ],
            },
        ],
    };
}

describe("damageDealtTrigger (CR 120.3 / 603.4)", () => {
    it("rejects non-DAMAGE_DEALT events", () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "self",
            resolve: () => {},
        });
        const evt: GameEvent = { type: "STATE_CHECK" };
        expect(ab.matches(evt, makeSelf())).toBe(false);
    });

    it('source: "self" matches only when sourceInstanceId equals self.id', () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "self",
            resolve: () => {},
        });
        expect(
            ab.matches(makeEvent({ sourceInstanceId: "self-1" }), makeSelf())
        ).toBe(true);
        expect(
            ab.matches(makeEvent({ sourceInstanceId: "other" }), makeSelf())
        ).toBe(false);
    });

    it('source: "yours" matches when controllers align (CR 109.4)', () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "yours",
            resolve: () => {},
        });
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p1" }), makeSelf())
        ).toBe(true);
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p2" }), makeSelf())
        ).toBe(false);
    });

    it('source: "opponents" is the controller-mismatch case', () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "opponents",
            resolve: () => {},
        });
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p2" }), makeSelf())
        ).toBe(true);
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p1" }), makeSelf())
        ).toBe(false);
    });

    it('source: "any" matches regardless of controller', () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            resolve: () => {},
        });
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p2" }), makeSelf())
        ).toBe(true);
    });

    it('target { kind: "player", player: { relation: "opponent" } } excludes self damage to controller', () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "self",
            target: { kind: "player", player: { relation: "opponent" } },
            resolve: () => {},
        });
        // Damage to p2 (opponent of p1): match
        expect(
            ab.matches(
                makeEvent({
                    sourceInstanceId: "self-1",
                    target: { type: "player", id: "p2" },
                }),
                makeSelf(),
                makeView()
            )
        ).toBe(true);
        // Damage to p1 (self): no match
        expect(
            ab.matches(
                makeEvent({
                    sourceInstanceId: "self-1",
                    target: { type: "player", id: "p1" },
                }),
                makeSelf(),
                makeView()
            )
        ).toBe(false);
    });

    it("sourceFilter narrows on source colors (CR 202.2)", () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            sourceFilter: { colors: "R" },
            resolve: () => {},
        });
        expect(ab.matches(makeEvent({ sourceColors: ["R"] }), makeSelf())).toBe(
            true
        );
        expect(ab.matches(makeEvent({ sourceColors: ["U"] }), makeSelf())).toBe(
            false
        );
    });

    it("isCombat: true matches only combat damage (CR 510)", () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            isCombat: true,
            resolve: () => {},
        });
        expect(ab.matches(makeEvent({ isCombat: true }), makeSelf())).toBe(
            true
        );
        expect(ab.matches(makeEvent({ isCombat: false }), makeSelf())).toBe(
            false
        );
    });

    it("interveningIf is mirrored onto the resulting ability (CR 603.4d)", () => {
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            interveningIf: (_event, self) => !self.isTapped,
            resolve: () => {},
        });
        expect(ab.interveningIf).toBeDefined();
        // Untapped → trigger qualifies
        expect(
            ab.matches(makeEvent(), makeSelf({ isTapped: false }), makeView())
        ).toBe(true);
        expect(
            ab.interveningIf?.(makeEvent(), makeSelf({ isTapped: false }))
        ).toBe(true);
        // Tapped → fails at both check and resolve gates
        expect(
            ab.matches(makeEvent(), makeSelf({ isTapped: true }), makeView())
        ).toBe(false);
        expect(
            ab.interveningIf?.(makeEvent(), makeSelf({ isTapped: true }))
        ).toBe(false);
    });

    it("condition is an additional check-time gate (CR 603.4)", () => {
        const calls: number[] = [];
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            condition: (event) => {
                calls.push(event.amount);
                return event.amount >= 3;
            },
            resolve: () => {},
        });
        expect(ab.matches(makeEvent({ amount: 2 }), makeSelf())).toBe(false);
        expect(ab.matches(makeEvent({ amount: 4 }), makeSelf())).toBe(true);
        expect(calls).toEqual([2, 4]);
    });

    it("derived payload exposes source colors/types and amount/target", () => {
        let seen: { amount: number; colors: ReadonlyArray<string> } | null =
            null;
        const ab = damageDealtTrigger({
            id: "t",
            oracleText: "x",
            source: "any",
            resolve: (_ctx, _event, damage) => {
                seen = {
                    amount: damage.amount,
                    colors: damage.source.colors,
                };
            },
        });
        // Invoke resolve directly with a synthetic event.
        ab.resolve!({} as never, makeEvent({ amount: 5, sourceColors: ["R"] }));
        expect(seen).toEqual({ amount: 5, colors: ["R"] });
    });
});

describe("damageTakenTrigger (CR 120.3 / 603.4)", () => {
    it('target { kind: "permanent", filter: { controllerRelation: "self" } } fires only on damage to self', () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: {
                kind: "permanent",
                filter: { controllerRelation: "self" },
            },
            resolve: () => {},
        });
        expect(
            ab.matches(
                makeEvent({ target: { type: "permanent", id: "self-1" } }),
                makeSelf(),
                makeView()
            )
        ).toBe(true);
        expect(
            ab.matches(
                makeEvent({ target: { type: "permanent", id: "opp-1" } }),
                makeSelf(),
                makeView()
            )
        ).toBe(false);
    });

    it('target { kind: "player", player: { relation: "controller" } } fires on damage to controller (Lich-style)', () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: { kind: "player", player: { relation: "controller" } },
            resolve: () => {},
        });
        expect(
            ab.matches(
                makeEvent({ target: { type: "player", id: "p1" } }),
                makeSelf(),
                makeView()
            )
        ).toBe(true);
        expect(
            ab.matches(
                makeEvent({ target: { type: "player", id: "p2" } }),
                makeSelf(),
                makeView()
            )
        ).toBe(false);
    });

    it("sourceFilter narrows the dealer side", () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: { kind: "any" },
            sourceFilter: { colors: "R" },
            resolve: () => {},
        });
        expect(ab.matches(makeEvent({ sourceColors: ["R"] }), makeSelf())).toBe(
            true
        );
        expect(ab.matches(makeEvent({ sourceColors: ["G"] }), makeSelf())).toBe(
            false
        );
    });

    it("optional source scope refines the dealer side", () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: { kind: "any" },
            source: "opponents",
            resolve: () => {},
        });
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p2" }), makeSelf())
        ).toBe(true);
        expect(
            ab.matches(makeEvent({ sourceControllerId: "p1" }), makeSelf())
        ).toBe(false);
    });

    it("rejects non-DAMAGE_DEALT events", () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: { kind: "any" },
            resolve: () => {},
        });
        const evt: GameEvent = { type: "STATE_CHECK" };
        expect(ab.matches(evt, makeSelf())).toBe(false);
    });

    it("interveningIf is mirrored onto the ability", () => {
        const ab = damageTakenTrigger({
            id: "t",
            oracleText: "x",
            target: { kind: "any" },
            interveningIf: (_event, self) => !self.isTapped,
            resolve: () => {},
        });
        expect(ab.interveningIf).toBeDefined();
        expect(
            ab.interveningIf?.(makeEvent(), makeSelf({ isTapped: true }))
        ).toBe(false);
    });
});
