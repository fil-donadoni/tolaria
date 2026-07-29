// Counter-placement meta-trigger foundation (issue #1319, CR 122.1). No card
// ships this yet — Emperor of Bones / Agatha's Cauldron (#917's #12/#14) are
// the future consumers. This suite proves the two load-bearing pieces:
//   1. `SpellContext.addCounter` emits a COUNTER_ADDED event (the choke point
//      every counter-adding effect already routes through), mirroring the
//      shipped COUNTER_REMOVED pattern (`removeCounter`, Vanishing's
//      sacrifice trigger).
//   2. `counterAddedTrigger` — the declarative factory building a
//      TriggeredAbility off that event — actually fires end-to-end: the
//      engine's normal trigger-collection pass (`processPendingActionTriggers`)
//      picks it up and stacks it, and it resolves like any other trigger.

import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    processPendingActionTriggers,
    resolveTopOfStack,
    getPlayer,
    type GameState,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import { counterAddedTrigger } from "../../cards/abilities/triggers/counterAddedTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardDefinition } from "../../cards/types";

const WATCHER_ID = "test-counter-added-watcher";
const BYSTANDER_ID = "test-counter-added-bystander";

// Fires only on +1/+1 counters placed on ITSELF; the resolve body gains its
// controller 1 life per occurrence (an easily-observed side effect that
// proves the trigger actually resolved, not just matched).
registerTokenDefinition({
    id: WATCHER_ID,
    name: "Test Counter Watcher",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        counterAddedTrigger({
            id: "test-counter-added-self",
            oracleText:
                "Whenever one or more +1/+1 counters are put on this creature, its controller gains 1 life.",
            scope: "self",
            counterType: "+1/+1",
            resolve: (ctx, _event, placed) => {
                ctx.gainLife(placed.controllerId, 1);
            },
        }),
    ],
} satisfies CardDefinition);

// A vanilla bystander with no trigger of its own — used to prove `scope:
// "self"` doesn't fire when a DIFFERENT permanent gets the counters.
registerTokenDefinition({
    id: BYSTANDER_ID,
    name: "Test Bystander",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
} satisfies CardDefinition);

function pushItem(state: GameState) {
    return pushSpell(state, WATCHER_ID, "p1");
}

describe("SpellContext.addCounter emits COUNTER_ADDED (CR 122.1, issue #1319)", () => {
    it("queues a COUNTER_ADDED pendingEvent with type/added/total", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "watcher1" }, "+1/+1", 2);

        expect(state.pendingEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "COUNTER_ADDED",
                    instanceId: "watcher1",
                    controllerId: "p1",
                    counterType: "+1/+1",
                    added: 2,
                    total: 2,
                }),
            ])
        );
    });

    it("does NOT emit for a zero-or-fewer count (addCounter's early return)", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "watcher2" }, "+1/+1", 0);

        expect(state.pendingEvents ?? []).toHaveLength(0);
    });

    it("total reflects counters already present before this placement", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher3",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "watcher3" }, "+1/+1", 1);

        expect(state.pendingEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "COUNTER_ADDED",
                    added: 1,
                    total: 4,
                }),
            ])
        );
    });
});

describe("counterAddedTrigger fires end-to-end (issue #1319 foundation)", () => {
    it("auto-collects onto the stack and resolves (controller gains 1 life)", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "watcher4" }, "+1/+1", 1);
        processPendingActionTriggers(state);

        const stackTrigger = state.stack.find(
            (s) => s.triggeredAbilityId === "test-counter-added-self"
        );
        expect(stackTrigger).toBeDefined();

        // Resolve every stack item down to the original spell (watcher4's
        // ETB isn't relevant here — just drain the trigger on top).
        while (
            state.stack.length > 0 &&
            state.stack[state.stack.length - 1]!.triggeredAbilityId ===
                "test-counter-added-self"
        ) {
            resolveTopOfStack(state);
        }

        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("a different counter TYPE on the same permanent does not fire (counterType filter)", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "watcher5" }, "charge", 1);
        processPendingActionTriggers(state);

        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-counter-added-self"
            )
        ).toBeUndefined();
    });

    it("scope: self does not fire when a DIFFERENT permanent gets the counters", () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher6",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bystander = makeInstance(BYSTANDER_ID, {
            id: "bystander1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher, bystander] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        ctx.addCounter({ type: "permanent", id: "bystander1" }, "+1/+1", 1);
        processPendingActionTriggers(state);

        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-counter-added-self"
            )
        ).toBeUndefined();
    });
});

// ADR 0078 — the factory grew a DSL leg so a Saga's chapter ability can be an
// Effect Script (the DSL-first default) instead of a `resolve()` closure.
describe("counterAddedTrigger authoring legs (ADR 0045 / ADR 0078)", () => {
    it("builds an `effects` ability with no `resolve`", () => {
        const ability = counterAddedTrigger({
            id: "dsl-leg",
            oracleText: "Whenever a counter is put on this, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        });
        expect(ability.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(ability.resolve).toBeUndefined();
    });

    it("rejects supplying both resolve and effects", () => {
        expect(() =>
            counterAddedTrigger({
                id: "both",
                oracleText: "x",
                scope: "self",
                resolve: () => {},
                effects: [],
            })
        ).toThrow(/exactly one of resolve \/ effects/);
    });

    it("rejects supplying neither", () => {
        expect(() =>
            counterAddedTrigger({
                id: "neither",
                oracleText: "x",
                scope: "self",
            })
        ).toThrow(/exactly one of resolve \/ effects/);
    });
});
