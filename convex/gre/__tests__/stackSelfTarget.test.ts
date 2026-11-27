// CR 115.5 — "A spell or ability on the stack is an illegal target for
// itself." CR 608.2n — "As the final part of an ability's resolution, the
// ability is removed from the stack and ceases to exist."
//
// Issue #10991: Tishana's Tidebinder's ETB trigger ("counter up to one target
// activated or triggered ability") was offered ITS OWN stack item as a target
// (a triggered ability chooses targets after it is put on the stack, CR
// 603.3d). Resolving, it countered itself, and the trigger branch's blind
// `state.stack.pop()` then took the creature spell BENEATH it, which vanished
// from every zone.
import { describe, it, expect } from "vitest";
import { registerTokenDefinition, getDefinition } from "../../cards/index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, getPlayer } from "../state";
import type { CardInstanceState, GameState, StackItem } from "../state";
import { collectTriggers } from "../triggers";
import { getLegalTargets, pendingTargetingSource } from "../rules";
import { raiseTriggerTargetSelection } from "../rules";
import { applyOneTargetSelection } from "../../game";
import { matchesSpellPendingTarget } from "../../../src/lib/card-utils";
import type { GameEvent } from "../../cards/types";

const TIDEBINDER_ID = "907b3d1d-8c85-4707-80b5-c4d832df9846";
const DROWNER_ID = "a6a62aa3-8edb-4000-8ebd-15ec4b00eed7";
const tidebinderDef = getDefinition(TIDEBINDER_ID);

const ACTIVATED_SOURCE_ID = "test-cr115-5-activated-source";
registerTokenDefinition({
    id: ACTIVATED_SOURCE_ID,
    name: ACTIVATED_SOURCE_ID,
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "test-cr115-5-draw",
            oracleText: "{1}: Draw a card.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

/** Tidebinder on p2's battlefield (flashed in), Drowner cast by p1 on the
 *  stack beneath. */
function drownerThenTidebinder(): {
    state: GameState;
    tidebinder: CardInstanceState;
    drowner: StackItem;
} {
    const tidebinder = makeInstance(TIDEBINDER_ID, {
        id: "tidebinder",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(DROWNER_ID, { id: "lib-1", zone: "library" }),
                ],
            }),
            makePlayer("p2", { battlefield: [tidebinder] }),
        ],
    });
    const drowner = pushSpell(state, DROWNER_ID, "p1");
    return { state, tidebinder, drowner };
}

/** Tidebinder's ETB trigger through the REAL `collectTriggers` pipeline (a
 *  fresh stack-item id, `triggerSourceId` = the permanent), on the stack. */
function pushTidebinderTrigger(
    state: GameState,
    tidebinder: CardInstanceState
): StackItem {
    const built = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: tidebinder.id,
            controllerId: tidebinder.controllerId,
            types: tidebinder.types,
        } as GameEvent,
    ]);
    const item = built.find((t) => t.triggerSourceId === tidebinder.id);
    expect(item).toBeDefined();
    state.stack.push(item!);
    return item!;
}

/** The trigger's own requirement, offered against its live on-stack source —
 *  exactly the pair `raiseTriggerTargetSelection` hands `getLegalTargets`. */
function offeredStackIds(state: GameState, trigger: StackItem): string[] {
    const req = tidebinderDef.triggeredAbilities![0]!.targetRequirement!;
    return getLegalTargets(
        state,
        req,
        pendingTargetingSource(state, trigger.id, "trigger"),
        trigger.controllerId
    )
        .filter((t) => t.type === "spell")
        .map((t) => t.id);
}

function zonesHolding(state: GameState, id: string): string[] {
    const zones: string[] = [];
    for (const p of state.players) {
        for (const zone of [
            "hand",
            "library",
            "graveyard",
            "exile",
            "battlefield",
        ] as const) {
            if (p[zone].some((c) => c.id === id)) zones.push(`${p.id}.${zone}`);
        }
    }
    if (state.stack.some((s) => s.id === id)) zones.push("stack");
    return zones;
}

describe("CR 115.5 — a spell or ability on the stack is an illegal target for itself (issue #10991)", () => {
    it("Tidebinder's trigger is never offered nor accepted as its own target", () => {
        const { state, tidebinder } = drownerThenTidebinder();
        // A real activated ability on the stack, so the "up to one" choice is
        // a genuine one and reaches the accepted-set check.
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        getPlayer(state, "p1").battlefield.push(bear);
        state.stack.push({
            ...bear,
            zone: "stack",
            castById: "p1",
            abilityId: "test-cr115-5-draw",
            targets: [],
        });
        const trigger = pushTidebinderTrigger(state, tidebinder);

        // Offered set: the bear's ability, never the trigger itself.
        expect(offeredStackIds(state, trigger)).toEqual(["bear"]);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.cardInstanceId).toBe(trigger.id);

        // Client highlighting: the trigger's own stack item is not selectable.
        const ctx = {
            playerId: "p2",
            activePlayerId: state.activePlayerId,
            players: state.players,
        };
        expect(matchesSpellPendingTarget(trigger, pt, ctx)).toBe(false);
        expect(matchesSpellPendingTarget(state.stack[1]!, pt, ctx)).toBe(true);

        // Accepted set (`selectTarget`'s body): submitting itself is refused.
        expect(() =>
            applyOneTargetSelection(state, "p2", {
                targetType: "spell",
                targetId: trigger.id,
            })
        ).toThrow(/can't target itself/);
    });

    it("with no other ability on the stack, the trigger targets nothing and the spell beneath still resolves", () => {
        const { state, tidebinder, drowner } = drownerThenTidebinder();
        const trigger = pushTidebinderTrigger(state, tidebinder);

        expect(offeredStackIds(state, trigger)).toEqual([]);
        raiseTriggerTargetSelection(state);
        // "Up to one" with zero candidates: no choice owed, no target locked.
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets ?? []).toEqual([]);

        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack.map((s) => s.id)).toEqual([drowner.id]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(zonesHolding(state, drowner.id)).toEqual(["p1.battlefield"]);
        expect(zonesHolding(state, tidebinder.id)).toEqual(["p2.battlefield"]);
        // Tidebinder countered nothing, so it kept its own abilities.
        const live = getPlayer(state, "p2").battlefield[0]!;
        expect(live.abilitiesSuppressedBy).toBeUndefined();
    });
});

describe("CR 608.2n — resolution removes the RESOLVING item, never whatever is on top (issue #10991)", () => {
    it("an ability that counters its own stack item leaves the spell beneath it, which then resolves", () => {
        const { state, tidebinder, drowner } = drownerThenTidebinder();
        const trigger = pushTidebinderTrigger(state, tidebinder);
        // The persisted shape the bug produced: the trigger locked onto
        // itself (pre-CR 115.5 fix), so its `counter` removes its own item.
        trigger.targets = [
            {
                type: "spell",
                id: trigger.id,
                stackSourceId: tidebinder.id,
            },
        ];

        expect(resolveTopOfStack(state)).not.toBeNull();
        // The Drowner spell is untouched — still on the stack.
        expect(state.stack.map((s) => s.id)).toEqual([drowner.id]);

        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(zonesHolding(state, drowner.id)).toEqual(["p1.battlefield"]);
    });
});
