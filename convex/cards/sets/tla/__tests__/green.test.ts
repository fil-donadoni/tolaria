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
    removePermanentTo,
} from "../../../../gre/state";
import { finalizeCleanup } from "../../../../gre/phases";
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

describe("Badgermole Cub — earthbend ETB (CR 701.66a target + animate + counters, issue #1317, corrected #2446)", () => {
    it("targets a land the controller controls, animates it to a 0/0-plus-counter land creature with haste (no granted subtype, CR 701.66a), indefinitely", () => {
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
        // CR 701.66a grants the CARD TYPE Creature "in addition to its other
        // types" — no creature subtype. Neither the rule nor the oracle text
        // grants "Elemental" (issue #2446).
        expect(animated.subtypes).not.toContain("Elemental");
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
        expect(slim.subtypes).not.toContain("Elemental");
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

// ─────────────────────────────────────────────────────────────────────────────
// Earthbend N's THIRD reminder sentence (issue #1470) — "When it dies or is
// exiled, return it to the battlefield tapped." Built on the new INDEFINITE
// instance leave-watch delayed-trigger timing (CR 603.7a /
// "leaves-battlefield-indefinite") plus #1469's moveZone return-a-departed-
// object shape (`from: "graveyard" | "exile"`, `tapped: true`).
// ─────────────────────────────────────────────────────────────────────────────

/** Earthbends `landId` (a Forest p1 controls) with Badgermole Cub's ETB, and
 *  returns the settled state. `landOwnerId` (issue #2446) defaults to "p1" —
 *  pass "p2" to stage the CR 701.66a sharp case: p1 EARTHBENDS a land it
 *  controls but does NOT own (p2 is the owner). The land still lives on p1's
 *  battlefield array (battlefield is controller-scoped) but carries
 *  `ownerId: "p2"`, so a departure sends it to P2's graveyard/exile pile (CR
 *  400.7/800.4a routes by owner) while the delayed return must still land it
 *  under P1's control (CR 701.66a "under your control" — "you" = the
 *  earthbending player, not the owner). */
function earthbend(landId: string, landOwnerId = "p1"): GameState {
    const cub = makeInstance(badgermoleCub.id, {
        id: `cub-${landId}`,
        controllerId: "p1",
        ownerId: "p1",
    });
    const land = makeInstance(forest.id, {
        id: landId,
        controllerId: "p1",
        ownerId: landOwnerId,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [cub, land] }),
            makePlayer("p2"),
        ],
    });
    earthbendTriggerOnStack(state, cub);
    raiseTriggerTargetSelection(state);
    resolveTopOfStack(state);
    return state;
}

/** Fires whatever leave-watches the last departure matched and drains them. */
function drainDelayedTriggers(state: GameState): void {
    processPendingActionTriggers(state);
    while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
        resolveTopOfStack(state);
    }
}

/** CR 400.7 — asserts the land came back as a NEW object: a plain, tapped
 *  land with no animation, no granted haste and no +1/+1 counters. */
function expectPlainTappedLand(state: GameState, landId: string): void {
    const back = state.players[0].battlefield.find((c) => c.id === landId)!;
    expect(back).toBeDefined();
    expect(back.isTapped).toBe(true); // CR 110.5a — returns tapped
    expect(back.types).toContain("Land");
    expect(back.types).not.toContain("Creature"); // animation reverted
    expect(back.subtypes).not.toContain("Elemental");
    expect(back.staticAbilities).not.toContain("haste");
    expect(back.counters?.["+1/+1"] ?? 0).toBe(0);
    expect(back.animation).toBeUndefined();
}

describe("Badgermole Cub — earthbend return clause (CR 603.7a indefinite leave-watch, issue #1470)", () => {
    it("schedules an INDEFINITE leave-watch keyed to the earthbent land", () => {
        const state = earthbend("watchedLand");
        const watch = state.delayedTriggers?.find(
            (t) => t.timing === "leaves-battlefield-indefinite"
        );
        expect(watch).toBeDefined();
        expect(watch!.watchInstanceId).toBe("watchedLand");
        // Payload keys are stored '$'-stripped (Convex reserves a leading '$').
        expect(watch!.payload).toEqual({ land: "watchedLand" });
    });

    it("CLEANUP does NOT purge the indefinite watch — but still purges the this-turn one (CR 514.2)", () => {
        const state = earthbend("survivor");
        // Plant a this-turn leave-watch alongside it (the Kjeldoran shape).
        state.delayedTriggers = [
            ...(state.delayedTriggers ?? []),
            {
                ...state.delayedTriggers![0],
                id: "delayed-this-turn",
                timing: "leaves-battlefield",
            },
        ];
        finalizeCleanup(state);
        const timings = (state.delayedTriggers ?? []).map((t) => t.timing);
        expect(timings).toContain("leaves-battlefield-indefinite");
        expect(timings).not.toContain("leaves-battlefield");
    });

    it("fires on a LATER turn: the land dies after CLEANUP and still returns tapped", () => {
        const state = earthbend("laterTurnLand");
        finalizeCleanup(state);
        state.turn += 1;
        removePermanentTo(state, "laterTurnLand", "graveyard");
        drainDelayedTriggers(state);
        expectPlainTappedLand(state, "laterTurnLand");
        expect(
            state.players[0].graveyard.some((c) => c.id === "laterTurnLand")
        ).toBe(false);
    });

    it("dies branch: the earthbent land goes to the graveyard and returns to the battlefield tapped as a plain land", () => {
        const state = earthbend("diedLand");
        removePermanentTo(state, "diedLand", "graveyard");
        drainDelayedTriggers(state);
        expectPlainTappedLand(state, "diedLand");
        // The watch is consumed — no double return.
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "leaves-battlefield-indefinite"
            ) ?? false
        ).toBe(false);
    });

    it("exile branch: an EXILED earthbent land returns to the battlefield tapped too", () => {
        const state = earthbend("exiledLand");
        removePermanentTo(state, "exiledLand", "exile");
        drainDelayedTriggers(state);
        expectPlainTappedLand(state, "exiledLand");
        expect(state.players[0].exile.some((c) => c.id === "exiledLand")).toBe(
            false
        );
    });

    // CR 701.66a's sharp case (issue #2446): the land's OWNER and its
    // CONTROLLER at earthbend time are different players. p1 earthbends a
    // land p1 controls but p2 owns — a control-magic-style divergence
    // (Standard Naming Convention, CR 108.3/800.4a). The owner/controller
    // split is set up DIRECTLY on the CardInstanceState (`ownerId: "p2"`,
    // `controllerId: "p1"`), never staged via a control-stealing effect card
    // — a static board is sufficient here and keeps the test independent of
    // any specific control-change card. This is deliberately NOT the shape
    // of the earlier tests in this file (owner === controller === "p1"),
    // which would pass identically whether `moveZone`'s `controller` field
    // is wired up or not — proving nothing about the clause under test.
    it("owner/controller split (CR 701.66a 'under YOUR control'): the land returns under the EARTHBENDING PLAYER's control, not its owner's", () => {
        const state = earthbend("splitLand", "p2"); // p1 controls, p2 owns
        const preReturn = state.players[0].battlefield.find(
            (c) => c.id === "splitLand"
        )!;
        expect(preReturn.controllerId).toBe("p1"); // earthbent under p1
        expect(preReturn.ownerId).toBe("p2"); // still owned by p2

        // CR 400.7/800.4a — a departing permanent goes to its OWNER's
        // graveyard, not its controller's.
        removePermanentTo(state, "splitLand", "graveyard");
        expect(
            state.players[1].graveyard.some((c) => c.id === "splitLand")
        ).toBe(true);

        drainDelayedTriggers(state);
        const back = state.players[0].battlefield.find(
            (c) => c.id === "splitLand"
        )!;
        expect(back).toBeDefined();
        // CR 701.66a: "return it to the battlefield tapped under YOUR
        // control" — "you" is the earthbending player (p1), fixed at
        // scheduling time, regardless of who owns the land.
        expect(back.controllerId).toBe("p1");
        expect(back.ownerId).toBe("p2"); // ownership never changes (CR 108.3)
        expect(back.isTapped).toBe(true);
    });

    // Same owner/controller split as above, but the land departs via the
    // EXILE branch of the delayed trigger's body (the second `moveZone` Op,
    // `from: "exile"`) rather than the graveyard branch. CR 701.66a covers
    // both departures in one sentence ("When that land dies or is put into
    // exile, return it to the battlefield tapped under your control") and
    // the two `moveZone` Ops carry the `controller: "controller"` field
    // independently — deleting it from only one branch left the other
    // branch's test green, so this branch needs its own regression guard.
    it("owner/controller split, EXILE branch: the land returns under the earthbending player's control, not its owner's", () => {
        const state = earthbend("splitExiled", "p2"); // p1 controls, p2 owns
        const preReturn = state.players[0].battlefield.find(
            (c) => c.id === "splitExiled"
        )!;
        expect(preReturn.controllerId).toBe("p1"); // earthbent under p1
        expect(preReturn.ownerId).toBe("p2"); // still owned by p2

        // CR 400.7/800.4a — a departing permanent goes to its OWNER's
        // exile-adjacent pile, not its controller's.
        removePermanentTo(state, "splitExiled", "exile");
        expect(state.players[1].exile.some((c) => c.id === "splitExiled")).toBe(
            true
        );

        drainDelayedTriggers(state);
        const back = state.players[0].battlefield.find(
            (c) => c.id === "splitExiled"
        )!;
        expect(back).toBeDefined();
        // CR 701.66a: "return it to the battlefield tapped under YOUR
        // control" — "you" is the earthbending player (p1), fixed at
        // scheduling time, regardless of who owns the land.
        expect(back.controllerId).toBe("p1");
        expect(back.ownerId).toBe("p2"); // ownership never changes (CR 108.3)
        expect(back.isTapped).toBe(true);
    });

    it("no-op (CR 608.2b): the land left the graveyard before the trigger resolved", () => {
        const state = earthbend("goneLand");
        removePermanentTo(state, "goneLand", "graveyard");
        processPendingActionTriggers(state);
        expect(state.stack.some((s) => s.delayedTriggerId !== undefined)).toBe(
            true
        );
        // Someone scoops it out of the graveyard in response.
        const p1 = state.players[0];
        const idx = p1.graveyard.findIndex((c) => c.id === "goneLand");
        p1.hand.push(...p1.graveyard.splice(idx, 1));
        resolveTopOfStack(state);
        expect(p1.battlefield.some((c) => c.id === "goneLand")).toBe(false);
        expect(p1.hand.some((c) => c.id === "goneLand")).toBe(true);
    });

    it("wire format: the returned plain tapped land survives projectPublicState", () => {
        const state = earthbend("wireLand");
        removePermanentTo(state, "wireLand", "graveyard");
        drainDelayedTriggers(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wireLand"
        )!;
        expect(slim).toBeDefined();
        expect(slim.isTapped).toBe(true);
        expect(slim.types).toContain("Land");
        expect(slim.types).not.toContain("Creature");
        expect(slim.staticAbilities).not.toContain("haste");
        expect(slim.counters?.["+1/+1"] ?? 0).toBe(0);
    });
});
