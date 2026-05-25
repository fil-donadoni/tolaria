// Unit tests for the `stateTrigger` factory (CR 603.8).
//
// The factory is intentionally tiny — it adapts a `condition(self, state)`
// predicate into a `TriggeredAbility` shaped for the engine. These tests pin
// down the contract: event narrowing, predicate routing, and the auto-baked
// CR 603.8 re-check via `interveningIf`. End-to-end "trigger fires + resolves
// + sacrifice happens" coverage lives next to its consumer in `lea.test.ts`
// (Sea Serpent).

import { describe, it, expect, vi } from "vitest";
import { stateTrigger } from "../stateTrigger";
import type {
    GameEvent,
    PermanentView,
    TriggerStateView,
} from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeStateView(): TriggerStateView {
    return {
        players: [
            { id: "p1", life: 20, hand: [], battlefield: [] },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ],
    };
}

describe("stateTrigger factory (CR 603.8)", () => {
    it("declares event: 'STATE_CHECK' and forwards id + oracleText", () => {
        const ability = stateTrigger({
            id: "test-id",
            oracleText: "Foo bar baz.",
            condition: () => true,
            resolve: () => {},
        });
        expect(ability.event).toBe("STATE_CHECK");
        expect(ability.id).toBe("test-id");
        expect(ability.oracleText).toBe("Foo bar baz.");
    });

    it("matches() returns true on STATE_CHECK when condition is true", () => {
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition: () => true,
            resolve: () => {},
        });
        const ev: GameEvent = { type: "STATE_CHECK" };
        expect(ability.matches(ev, makeSelf(), makeStateView())).toBe(true);
    });

    it("matches() returns false on STATE_CHECK when condition is false", () => {
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition: () => false,
            resolve: () => {},
        });
        const ev: GameEvent = { type: "STATE_CHECK" };
        expect(ability.matches(ev, makeSelf(), makeStateView())).toBe(false);
    });

    it("matches() returns false on non-STATE_CHECK events even when the predicate would be true", () => {
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition: () => true,
            resolve: () => {},
        });
        const ev: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        };
        expect(ability.matches(ev, makeSelf(), makeStateView())).toBe(false);
    });

    it("matches() returns false when state is omitted (cannot evaluate a state predicate without state)", () => {
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition: () => true,
            resolve: () => {},
        });
        const ev: GameEvent = { type: "STATE_CHECK" };
        expect(ability.matches(ev, makeSelf(), undefined)).toBe(false);
    });

    it("interveningIf is set and mirrors `condition` so CR 603.8 fizzles automatically", () => {
        const condition = vi.fn((self: PermanentView) => self.isTapped);
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition,
            resolve: () => {},
        });
        expect(ability.interveningIf).toBeDefined();
        const ev: GameEvent = { type: "STATE_CHECK" };
        const tapped = makeSelf({ isTapped: true });
        const untapped = makeSelf({ isTapped: false });
        expect(ability.interveningIf!(ev, tapped, makeStateView())).toBe(true);
        expect(ability.interveningIf!(ev, untapped, makeStateView())).toBe(
            false
        );
    });

    it("interveningIf passes the same (self, state) tuple to the user predicate as matches()", () => {
        const condition = vi.fn(() => true);
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition,
            resolve: () => {},
        });
        const ev: GameEvent = { type: "STATE_CHECK" };
        const self = makeSelf();
        const state = makeStateView();
        ability.matches(ev, self, state);
        ability.interveningIf!(ev, self, state);
        // Both calls feed the same (self, state) pair — the factory never
        // synthesizes alternate arguments.
        expect(condition).toHaveBeenCalledTimes(2);
        expect(condition).toHaveBeenNthCalledWith(1, self, state);
        expect(condition).toHaveBeenNthCalledWith(2, self, state);
    });

    it("resolve() forwards to the user-supplied resolve callback", () => {
        const userResolve = vi.fn();
        const ability = stateTrigger({
            id: "t",
            oracleText: "",
            condition: () => true,
            resolve: userResolve,
        });
        const fakeCtx = { sourceInstanceId: "self" } as never;
        const ev: GameEvent = { type: "STATE_CHECK" };
        ability.resolve(fakeCtx, ev);
        expect(userResolve).toHaveBeenCalledWith(fakeCtx);
    });
});
