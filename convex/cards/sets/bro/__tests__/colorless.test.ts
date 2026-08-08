// BRO (The Brothers' War) — colorless behavior tests (ADR 0043 colour split).
//
// Portal to Phyrexia is DSL-only but the canned smoke generator explicitly
// SKIPS both its abilities ("choice suspends for player input" on the ETB,
// "moveZone changes zones ... not modelled" on the upkeep trigger) — per the
// per-Op regime (`.claude/rules/gre-development.md` § DSL-first authoring),
// an explicit skip is the signal to add a hand-written test, so both
// abilities get one here.

import { describe, it, expect } from "vitest";
import { portalToPhyrexia } from "../colorless";
import { savannahLions } from "../../lea/white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";

/** Puts Portal's ETB trigger on the stack (untargeted — the sacrifice pick
 *  is a resolution-time `choice`, not an announced target). */
function portalEtbTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "trig-portal-etb",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "portal-to-phyrexia-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: source.types,
        } as StackItem["triggerEvent"],
        targets: [],
    };
    state.stack.push(trig);
    return trig;
}

/** Puts Portal's upkeep trigger on the stack with an UN-set target slot,
 *  mirroring `buildTriggerItem` for a CR 603.3d targeted trigger. */
function portalUpkeepTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "trig-portal-upkeep",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "portal-to-phyrexia-upkeep",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: source.controllerId,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d graveyard-target choice through the real machinery. */
function choosePortalTarget(
    state: GameState,
    target: { id: string; playerId: string } | null
) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = target
        ? [{ type: "graveyard-card", id: target.id, playerId: target.playerId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Portal to Phyrexia (CR 603.6a ETB sacrifice + CR 603.3d targeted upkeep reanimation, issue #1965)", () => {
    it("ETB: each opponent sacrifices three creatures of their choice (CR 701.16)", () => {
        const portal = makeInstance(portalToPhyrexia.id, {
            id: "portal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const opp = (cid: string) =>
            makeInstance(savannahLions.id, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
            });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [portal] }),
                makePlayer("p2", {
                    battlefield: [opp("c1"), opp("c2"), opp("c3"), opp("c4")],
                }),
            ],
        });
        portalEtbTriggerOnStack(state, portal);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p2");
        expect(head.count).toBe(3);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["c1", "c2", "c3"],
        });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["c4"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["c1", "c2", "c3"])
        );
        expect(state.stack).toHaveLength(0);
    });

    it("ETB: clamps to however many creatures the opponent actually controls (CR 608.2b)", () => {
        const portal = makeInstance(portalToPhyrexia.id, {
            id: "portal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const opp1 = makeInstance(savannahLions.id, {
            id: "onlyOne",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [portal] }),
                makePlayer("p2", { battlefield: [opp1] }),
            ],
        });
        portalEtbTriggerOnStack(state, portal);
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["onlyOne"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("upkeep: reanimates a creature card from ANY graveyard under the controller's control, and it becomes a Phyrexian", () => {
        const portal = makeInstance(portalToPhyrexia.id, {
            id: "portal",
            controllerId: "p1",
            ownerId: "p1",
        });
        // TWO legal candidates (one in each graveyard) so the pick is a real
        // announced choice, not CR 603.3d's sole-legal-target auto-select —
        // proving `zone: "graveyard"` + `controller: "any"` genuinely offers
        // BOTH graveyards, not just the controller's own.
        const ownDead = makeInstance(savannahLions.id, {
            id: "own-dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const deadCreature = makeInstance(savannahLions.id, {
            id: "dead-lion",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [portal],
                    graveyard: [ownDead],
                }),
                makePlayer("p2", { graveyard: [deadCreature] }),
            ],
        });
        portalUpkeepTriggerOnStack(state, portal);
        // Pick the CROSS-PLAYER (opponent's) graveyard creature, not the
        // controller's own — the case `controller: "you"` would forbid.
        choosePortalTarget(state, { id: "dead-lion", playerId: "p2" });
        expect(resolveTopOfStack(state)).not.toBeNull();

        // Reanimated under the ABILITY's controller (p1), not the owner (p2).
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "dead-lion"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
        expect(
            state.players[1].graveyard.find((c) => c.id === "dead-lion")
        ).toBeUndefined();
        // "It's a Phyrexian in addition to its other types" (CR 613.1d).
        expect(reanimated!.subtypes).toContain("Phyrexian");
        expect(reanimated!.subtypes).toContain("Cat"); // keeps its other subtypes
    });

    it("upkeep: removes the trigger with no legal target when both graveyards are empty (CR 603.3c)", () => {
        const portal = makeInstance(portalToPhyrexia.id, {
            id: "portal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [portal] }),
                makePlayer("p2"),
            ],
        });
        portalUpkeepTriggerOnStack(state, portal);
        const raised = raiseTriggerTargetSelection(state);
        // No legal targets at all — CR 603.3c removes the trigger from the
        // stack instead of prompting; nothing is reanimated.
        expect(raised).toBe(false);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "portal",
        ]);
    });
});
