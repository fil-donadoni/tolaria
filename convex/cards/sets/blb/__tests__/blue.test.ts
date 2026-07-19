// blb (Bloomburrow) — per-card behavior tests for blue cards in
// `convex/cards/sets/blb/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { azureBeastbinder } from "../blue";
import { balduvianBears } from "../../ice/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

const BEAR_ID = balduvianBears.id;

function attackEvent(attackerId: string): StackItem["triggerEvent"] {
    return {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: [attackerId],
    };
}

function pushAttackTrigger(
    state: GameState,
    beastbinder: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...beastbinder,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "azure-beastbinder-attack",
        triggerSourceId: beastbinder.id,
        triggerEvent: attackEvent(beastbinder.id),
    });
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target (or
 *  the empty "decline" set) onto the on-stack trigger. */
function chooseTarget(state: GameState, targetId: string | null) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Azure Beastbinder (CR 509.1b block restriction + 508.1 attack trigger)", () => {
    it("is a {1}{U} 1/3 Rat Rogue with vigilance", () => {
        expect(azureBeastbinder.manaCost).toEqual({ X: 1, U: 1 });
        expect(azureBeastbinder.power).toBe(1);
        expect(azureBeastbinder.toughness).toBe(3);
        expect(azureBeastbinder.staticAbilities).toEqual(["vigilance"]);
    });

    it("declares the CR 603.3d target requirement: up to one opponent-controlled artifact/creature/planeswalker", () => {
        expect(
            azureBeastbinder.triggeredAbilities?.[0]?.targetRequirement
        ).toEqual({
            type: ["Artifact", "Creature", "Planeswalker"],
            count: { min: 0, max: 1 },
            controller: "opponent",
        });
    });

    it("can't be blocked by creatures with power 2 or greater (CR 509.1b)", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const strongBlocker = makeInstance(BEAR_ID, {
            id: "strong",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 2,
        });
        const weakBlocker = makeInstance(BEAR_ID, {
            id: "weak",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [strongBlocker, weakBlocker] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        expect(
            validateBlockerEligibility(
                beastbinder,
                strongBlocker,
                [strongBlocker, weakBlocker],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                beastbinder,
                weakBlocker,
                [strongBlocker, weakBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("attack trigger strips all abilities and sets base P/T 2/2 on a chosen opposing creature until the controller's next turn", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, "target");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(target.staticAbilities).toEqual([]);
        expect(getEffectivePower(state, target)).toBe(2);
        expect(getEffectiveToughness(state, target)).toBe(2);
    });

    it("is a no-op ('up to one') when the controller declines a target", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(target.staticAbilities).toEqual(["flying"]);
    });

    it("wire format: the stripped abilities and reset P/T survive projection", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, "target");
        expect(resolveTopOfStack(state)).not.toBeNull();
        const projected = projectPublicState(state, 1, "p2");
        const slimTarget = projected.players[1].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(slimTarget.staticAbilities).toEqual([]);
        expect(getEffectivePower(projected, slimTarget)).toBe(2);
        expect(getEffectiveToughness(projected, slimTarget)).toBe(2);
    });
});
