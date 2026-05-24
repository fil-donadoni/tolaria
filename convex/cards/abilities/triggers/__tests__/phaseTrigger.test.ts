// Unit tests for the `phaseTrigger` factory and `resolvePhaseScope`
// helper. Exercises the contract used by every LEA card migrated in slice 3
// of the trigger-factory rollout (issue #4 / PRD #1).

import { describe, expect, it } from "vitest";
import type {
    PermanentView,
    PhaseBeginEvent,
    SpellContext,
    TriggerStateView,
} from "../../../types";
import { phaseTrigger } from "../phaseTrigger";
import { resolvePhaseScope } from "../shared";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(overrides: Partial<PhaseBeginEvent> = {}): PhaseBeginEvent {
    return {
        type: "PHASE_BEGIN",
        phase: "UPKEEP",
        activePlayerId: "p1",
        ...overrides,
    };
}

function makeState(
    overrides: Partial<TriggerStateView> = {}
): TriggerStateView {
    return {
        players: [
            { id: "p1", life: 20, battlefield: [] },
            { id: "p2", life: 20, battlefield: [] },
        ],
        ...overrides,
    };
}

describe("resolvePhaseScope", () => {
    it("scope=each returns activePlayerId unconditionally", () => {
        expect(
            resolvePhaseScope(
                "each",
                makeEvent({ activePlayerId: "p2" }),
                makeSelf()
            )
        ).toBe("p2");
    });

    it("scope=your returns controllerId on controller's turn, null otherwise", () => {
        const self = makeSelf({ controllerId: "p1" });
        expect(
            resolvePhaseScope("your", makeEvent({ activePlayerId: "p1" }), self)
        ).toBe("p1");
        expect(
            resolvePhaseScope("your", makeEvent({ activePlayerId: "p2" }), self)
        ).toBeNull();
    });

    it("scope=opponents returns activePlayerId on opponent's turn, null otherwise", () => {
        const self = makeSelf({ controllerId: "p1" });
        expect(
            resolvePhaseScope(
                "opponents",
                makeEvent({ activePlayerId: "p2" }),
                self
            )
        ).toBe("p2");
        expect(
            resolvePhaseScope(
                "opponents",
                makeEvent({ activePlayerId: "p1" }),
                self
            )
        ).toBeNull();
    });

    it("scope=host-controller returns host's controller when active player matches", () => {
        const self = makeSelf({ controllerId: "p1", attachedTo: "host" });
        const host = {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
        };
        const state = makeState({
            players: [
                { id: "p1", life: 20, battlefield: [] },
                { id: "p2", life: 20, battlefield: [host] },
            ],
        });
        // Host controller is p2; trigger fires only on p2's upkeep.
        expect(
            resolvePhaseScope(
                "host-controller",
                makeEvent({ activePlayerId: "p2" }),
                self,
                state
            )
        ).toBe("p2");
        expect(
            resolvePhaseScope(
                "host-controller",
                makeEvent({ activePlayerId: "p1" }),
                self,
                state
            )
        ).toBeNull();
    });

    it("scope=host-controller returns null when aura is unattached", () => {
        const self = makeSelf({ attachedTo: undefined });
        expect(
            resolvePhaseScope("host-controller", makeEvent(), self, makeState())
        ).toBeNull();
    });

    it("scope=host-controller returns null when host has left play", () => {
        const self = makeSelf({ controllerId: "p1", attachedTo: "ghost" });
        // No permanent with id "ghost" anywhere.
        expect(
            resolvePhaseScope("host-controller", makeEvent(), self, makeState())
        ).toBeNull();
    });
});

describe("phaseTrigger factory", () => {
    const dummyResolve = () => {};

    it("produces a TriggeredAbility with event=PHASE_BEGIN", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "your",
            resolve: dummyResolve,
        });
        expect(ability.event).toBe("PHASE_BEGIN");
        expect(ability.id).toBe("test");
        expect(ability.oracleText).toBe("test");
    });

    it("matches() rejects non-PHASE_BEGIN events", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "each",
            resolve: dummyResolve,
        });
        expect(
            ability.matches(
                { type: "CREATURE_DIED" } as never,
                makeSelf(),
                makeState()
            )
        ).toBe(false);
    });

    it("matches() rejects mismatched phase", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "each",
            resolve: dummyResolve,
        });
        expect(
            ability.matches(
                makeEvent({ phase: "DRAW" }),
                makeSelf(),
                makeState()
            )
        ).toBe(false);
    });

    it("matches() rejects when scope predicate fails", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "your",
            resolve: dummyResolve,
        });
        expect(
            ability.matches(
                makeEvent({ activePlayerId: "p2" }),
                makeSelf({ controllerId: "p1" }),
                makeState()
            )
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent({ activePlayerId: "p1" }),
                makeSelf({ controllerId: "p1" }),
                makeState()
            )
        ).toBe(true);
    });

    it("matches() runs the optional condition filter at trigger time", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "each",
            condition: (_event, self) => self.isTapped === true,
            resolve: dummyResolve,
        });
        expect(
            ability.matches(
                makeEvent(),
                makeSelf({ isTapped: false }),
                makeState()
            )
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent(),
                makeSelf({ isTapped: true }),
                makeState()
            )
        ).toBe(true);
    });

    it("matches() also gates on interveningIf (CR 603.4d trigger-time check)", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "DRAW",
            scope: "each",
            interveningIf: (_event, self) => !self.isTapped,
            resolve: dummyResolve,
        });
        expect(
            ability.matches(
                makeEvent({ phase: "DRAW" }),
                makeSelf({ isTapped: true }),
                makeState()
            )
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent({ phase: "DRAW" }),
                makeSelf({ isTapped: false }),
                makeState()
            )
        ).toBe(true);
    });

    it("forwards interveningIf to the engine via the TriggeredAbility field", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "DRAW",
            scope: "each",
            interveningIf: (_event, self) => !self.isTapped,
            resolve: dummyResolve,
        });
        expect(ability.interveningIf).toBeDefined();
        expect(
            ability.interveningIf!(
                makeEvent({ phase: "DRAW" }),
                makeSelf({ isTapped: false }),
                makeState()
            )
        ).toBe(true);
        expect(
            ability.interveningIf!(
                makeEvent({ phase: "DRAW" }),
                makeSelf({ isTapped: true }),
                makeState()
            )
        ).toBe(false);
    });

    it("omits interveningIf when none provided (no engine fizzle path)", () => {
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "each",
            resolve: dummyResolve,
        });
        expect(ability.interveningIf).toBeUndefined();
    });

    it("resolve() passes scopedPlayerId = event.activePlayerId for scope=each", () => {
        let received: string | undefined;
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "each",
            resolve: (_ctx, _event, scoped) => {
                received = scoped;
            },
        });
        const ctx = { controller: "p1" } as unknown as SpellContext;
        ability.resolve(ctx, makeEvent({ activePlayerId: "p2" }));
        expect(received).toBe("p2");
    });

    it("resolve() passes scopedPlayerId = ctx.controller for scope=your", () => {
        let received: string | undefined;
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "your",
            resolve: (_ctx, _event, scoped) => {
                received = scoped;
            },
        });
        const ctx = { controller: "p1" } as unknown as SpellContext;
        ability.resolve(ctx, makeEvent({ activePlayerId: "p1" }));
        expect(received).toBe("p1");
    });

    it("resolve() reads host controller via SpellContext for scope=host-controller", () => {
        let received: string | undefined;
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (_ctx, _event, scoped) => {
                received = scoped;
            },
        });
        const ctx = {
            controller: "p1",
            sourceInstanceId: "aura-1",
            getAttachedTo: (id: string) =>
                id === "aura-1" ? "host-1" : undefined,
            getController: (t: { id: string }) =>
                t.id === "host-1" ? "p2" : "?",
        } as unknown as SpellContext;
        ability.resolve(ctx, makeEvent({ activePlayerId: "p2" }));
        expect(received).toBe("p2");
    });

    it("resolve() short-circuits for host-controller when host has left play", () => {
        let resolved = false;
        const ability = phaseTrigger({
            id: "test",
            oracleText: "test",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: () => {
                resolved = true;
            },
        });
        const ctx = {
            controller: "p1",
            sourceInstanceId: "aura-1",
            getAttachedTo: () => undefined,
        } as unknown as SpellContext;
        ability.resolve(ctx, makeEvent());
        expect(resolved).toBe(false);
    });
});
