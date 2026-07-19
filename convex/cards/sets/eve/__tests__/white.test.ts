// eve (Eventide) — per-card behavior tests for white cards in
// `convex/cards/sets/eve/white.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { flickerwisp } from "../white";
import { balduvianBears } from "../../ice/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { PERMANENT_TYPES } from "../../../types";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

function etbEvent(instanceId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        types: ["Creature"],
    } as StackItem["triggerEvent"];
}

/** Puts Flickerwisp's ETB trigger on the stack (PERMANENT_ENTERED, CR 603.6a).
 *  The trigger now carries a `targetRequirement`, so `raiseTriggerTargetSelection`
 *  must run before resolving (see `chooseTarget`). The on-stack item keeps its
 *  `triggerSourceId` so `excludeSource` can drop Flickerwisp herself. */
function pushEtbTrigger(
    state: GameState,
    wisp: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...wisp,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "flickerwisp-etb",
        triggerSourceId: wisp.id,
        triggerEvent: etbEvent(wisp.id),
        // Leave the target slot UNSET so `raiseTriggerTargetSelection` treats
        // the trigger as an un-targeted candidate (a `targets: []` here would
        // be read as "already locked to no target" and skipped).
        targets: undefined,
    });
}

/** Drives the CR 603.3d target choice through the real machinery. With 2+
 *  eligible permanents `raiseTriggerTargetSelection` returns true and raises a
 *  `kind:"trigger"` PendingTarget; `finalizeTargetSelection` then writes the
 *  chosen target onto the on-stack trigger. (When exactly one legal target
 *  exists — `count: 1` mandatory — the engine auto-locks it and `raise`
 *  returns false; that branch is exercised separately below.) */
function chooseTarget(state: GameState, targetId: string) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = [{ type: "permanent", id: targetId }];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Flickerwisp (CR 603.6a exile + CR 603.7a delayed return, next end step)", () => {
    it("is a {1}{W}{W} 3/1 Elemental with flying", () => {
        expect(flickerwisp.manaCost).toEqual({ X: 1, W: 2 });
        expect(flickerwisp.power).toBe(3);
        expect(flickerwisp.toughness).toBe(1);
        expect(flickerwisp.staticAbilities).toEqual(["flying"]);
    });

    it("declares the CR 603.3d target requirement: another target permanent", () => {
        expect(flickerwisp.triggeredAbilities?.[0]?.targetRequirement).toEqual({
            type: [...PERMANENT_TYPES],
            count: 1,
            excludeSource: true,
        });
    });

    it("exiles the chosen target permanent (any controller) and schedules a next-end-step return", () => {
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        // A second eligible permanent so the CR 603.3d choice is real (2+
        // legal targets → PendingTarget raised, not auto-locked).
        const decoy = makeInstance(balduvianBears.id, {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target, decoy] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        chooseTarget(state, "target");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("target");
        expect(state.delayedTriggers?.length).toBeGreaterThanOrEqual(1);
    });

    it("returns the exiled permanent to the battlefield at the next end step (CR 603.7a)", () => {
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const decoy = makeInstance(balduvianBears.id, {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target, decoy] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        chooseTarget(state, "target");
        resolveTopOfStack(state);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeDefined();
        expect(
            state.players[1].exile.find((c) => c.id === "target")
        ).toBeUndefined();
    });

    it("does not target itself (CR 608.2b — 'another target permanent') — no legal target, resolves as a no-op", () => {
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, wisp);
        // Only Flickerwisp herself exists, excluded by `excludeSource`. CR
        // 603.3c — a MANDATORY target (count: 1) with no legal object: the
        // trigger is removed from the stack, never resolves, no PendingTarget
        // is raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.find((c) => c.id === "wisp")
        ).toBeDefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("wire format: the returned permanent is visible on the owner's battlefield for both viewers", () => {
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const decoy = makeInstance(balduvianBears.id, {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target, decoy] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        chooseTarget(state, "target");
        resolveTopOfStack(state);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            expect(
                projected.players[1].battlefield.some((c) => c.id === "target")
            ).toBe(true);
        }
    });
});
