// TLA — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { badgermoleCub } from "../green";
import { forest } from "../../lea/colorless";
import { birdsOfParadise } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    emitPermanentTapped,
    processPendingActionTriggers,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";

/** Pushes Badgermole Cub's ETB (earthbend) triggered ability onto the stack
 *  with an unresolved target slot, mirroring the established
 *  `attackTriggerOnStack` shim (`sets/mh3/__tests__/white.test.ts`) for a
 *  CR 603.3d targeted trigger — a real cast-and-resolve of the creature spell
 *  isn't needed to exercise the target-lock + effects[] pipeline. */
function earthbendTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "badgermole-earthbend-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "badgermole-cub-earthbend",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            cardId: badgermoleCub.id,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

describe("Badgermole Cub — definition", () => {
    it("pins mana cost, stats, subtype, and both triggered abilities", () => {
        expect(badgermoleCub.manaCost).toEqual({ X: 1, G: 1 });
        expect(badgermoleCub.types).toEqual(["Creature"]);
        expect(badgermoleCub.subtypes).toEqual(["Badger Mole"]);
        expect(badgermoleCub.power).toBe(2);
        expect(badgermoleCub.toughness).toBe(2);
        expect(badgermoleCub.triggeredAbilities).toHaveLength(2);
    });
});

describe("Badgermole Cub — earthbend ETB (CR 603.3d target + CR 208.2/611.1 animate + CR 122 counters, issue #1317)", () => {
    it("targets a land the controller controls, animates it to a 0/0-plus-counter Elemental creature with haste, still a land, indefinitely", () => {
        const cub = makeInstance(badgermoleCub.id, {
            id: "cub1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const homeForest = makeInstance(forest.id, {
            id: "homeForest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub, homeForest] }),
                makePlayer("p2"),
            ],
        });
        earthbendTriggerOnStack(state, cub);

        // CR 603.3d — the sole legal "land you control" auto-selects.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        const trig = state.stack.find(
            (s) => s.id === "badgermole-earthbend-trig"
        )!;
        expect(trig.targets).toEqual([{ type: "permanent", id: "homeForest" }]);

        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "homeForest"
        )!;
        expect(animated.types).toContain("Creature");
        expect(animated.types).toContain("Land"); // CR 208.2 — still a land
        expect(animated.subtypes).toContain("Elemental");
        expect(animated.subtypes).toContain("Forest"); // printed subtype kept
        expect(animated.staticAbilities).toContain("haste");
        expect(animated.counters?.["+1/+1"]).toBe(1);
        // 7a base (0/0) + 7c counter (+1/+1) = 1/1 net toughness N (CR 613.4).
        expect(getEffectivePower(state, animated)).toBe(1);
        expect(getEffectiveToughness(state, animated)).toBe(1);
        // CR 611.2b — no duration clause in the reminder text: indefinite.
        expect(animated.animation?.duration).toBeUndefined();

        // Wire format — the animation's types/subtypes/abilities/counters are
        // all board-visible and must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "homeForest"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Land");
        expect(slim.subtypes).toContain("Elemental");
        expect(slim.staticAbilities).toContain("haste");
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });

    it("does not offer an opponent's land as a legal target", () => {
        const cub = makeInstance(badgermoleCub.id, {
            id: "cub2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirForest = makeInstance(forest.id, {
            id: "theirForest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub] }),
                makePlayer("p2", { battlefield: [theirForest] }),
            ],
        });
        earthbendTriggerOnStack(state, cub);
        // No legal target (CR 603.3c) — the trigger is removed from the stack
        // rather than resolving with an illegal/absent target.
        raiseTriggerTargetSelection(state);
        expect(
            state.stack.find((s) => s.id === "badgermole-earthbend-trig")
        ).toBeUndefined();
    });

    // CR 704.5f — an earthbent land that later loses its counters is a 0/0
    // creature and dies as a state-based action, same as any other creature.
    it("SBA: the animated land dies if its counters are removed and it drops to 0 toughness", async () => {
        const { checkStateBasedActions } = await import("../../../../gre/sba");
        const cub = makeInstance(badgermoleCub.id, {
            id: "cub3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const homeForest = makeInstance(forest.id, {
            id: "homeForestSba",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub, homeForest] }),
                makePlayer("p2"),
            ],
        });
        earthbendTriggerOnStack(state, cub);
        raiseTriggerTargetSelection(state);
        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "homeForestSba"
        )!;
        expect(getEffectiveToughness(state, animated)).toBe(1);
        // Strip the counter that was keeping it above 0 toughness.
        animated.counters = { "+1/+1": 0 };
        checkStateBasedActions(state);
        const stillOnBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "homeForestSba"
        );
        expect(stillOnBattlefield).toBeUndefined();
        const inGraveyard = state.players[0].graveyard.find(
            (c) => c.id === "homeForestSba"
        );
        expect(inGraveyard).toBeDefined();
    });
});

describe("Badgermole Cub — mana doubler (CR 605.4, tap a creature for mana, issue #1317)", () => {
    it("adds an additional {G} when the controller taps a CREATURE for mana", () => {
        const cub = makeInstance(badgermoleCub.id, {
            id: "cub4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dork = makeInstance(birdsOfParadise.id, {
            id: "dork",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub, dork] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        p1.manaPool = { ...(p1.manaPool ?? {}), G: 1 };
        emitPermanentTapped(state, dork, true, { G: 1 });
        processPendingActionTriggers(state);
        // CR 605.4 — resolves without the stack.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].manaPool?.G).toBe(2);
    });

    it("does NOT trigger when a LAND (non-creature) is tapped for mana", () => {
        const cub = makeInstance(badgermoleCub.id, {
            id: "cub5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "plainForest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub, land] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        p1.manaPool = { ...(p1.manaPool ?? {}), G: 1 };
        emitPermanentTapped(state, land, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.players[0].manaPool?.G).toBe(1);
    });
});
