// tla (Avatar: The Last Airbender) — per-card behavior tests for white cards
// in `convex/cards/sets/tla/white.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { aangsIceberg } from "../white";
import { balduvianBears } from "../../ice/green";
import { snowCoveredForest } from "../../ice/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { checkStateBasedActions } from "../../../../gre/sba";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

function etbEvent(instanceId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        types: ["Enchantment"],
    } as StackItem["triggerEvent"];
}

/** Puts Aang's Iceberg's ETB trigger on the stack WITHOUT resolving it. The
 *  trigger now carries a `targetRequirement`, so the CR 603.3d target choice
 *  is driven through `chooseIcebergTarget` before `resolveTopOfStack`. */
function pushEtbTrigger(
    state: GameState,
    iceberg: ReturnType<typeof makeInstance>
): StackItem {
    const trig: StackItem = {
        ...iceberg,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "aangs-iceberg-exile",
        triggerSourceId: iceberg.id,
        triggerEvent: etbEvent(iceberg.id),
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function chooseIcebergTarget(state: GameState, targetId: string | null) {
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

function resolveActivated(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
    abilityId: string
) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

function submitChoice(state: GameState, cardInstanceIds: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Aang's Iceberg (CR 603.6a exile-until-leaves + CR 701.22-style scry)", () => {
    it("ETB exiles up to one chosen nonland permanent (CR 603.6a, target locked at stack placement per CR 603.3d)", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [iceberg] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, iceberg);
        chooseIcebergTarget(state, "target");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("target");
        const bundle = state.exileHeld?.find((b) => b.sourceId === "iceberg");
        expect(bundle?.hostId).toBe("target");
    });

    it("declines the 'up to one' target — no exile, no bundle (CR 603.3d)", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [iceberg] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, iceberg);
        chooseIcebergTarget(state, null);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeDefined();
        expect(state.exileHeld ?? []).toHaveLength(0);
    });

    it("excludes lands and Aang's Iceberg itself — no legal target, resolves as a no-op (CR 603.3c)", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(snowCoveredForest.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [iceberg] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        const trig = pushEtbTrigger(state, iceberg);
        // Only Aang's Iceberg itself (excluded by `excludeSource`) and a land
        // (excluded by `excludeTypes`) exist — no legal nonland permanent. CR
        // 603.3d "up to one" with none legal: the engine locks an empty target
        // set, no PendingTarget is raised, and the trigger resolves as a no-op.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.exileHeld ?? []).toHaveLength(0);
    });

    it("returns the exiled permanent when Aang's Iceberg leaves (CR 603.7a)", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [iceberg] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, iceberg);
        chooseIcebergTarget(state, "target");
        resolveTopOfStack(state);

        removePermanentTo(state, "iceberg", "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "aangs-iceberg-return"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);

        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeDefined();
        expect(state.exileHeld ?? []).toHaveLength(0);
        checkStateBasedActions(state);
    });

    it("Waterbend {3}: sacrifices itself, then scries 2", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(balduvianBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const under = makeInstance(balduvianBears.id, {
            id: "under",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [iceberg],
                    library: [top, under],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, iceberg, "aangs-iceberg-waterbend");
        // Sacrificed already; suspended on the scry-2 partition choice.
        expect(
            state.players[0].battlefield.find((c) => c.id === "iceberg")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "iceberg"
        );
        submitChoice(state, ["top"]);
        // "top" went to the bottom; "under" stays on top.
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds[0]).toBe("under");
        expect(libIds[libIds.length - 1]).toBe("top");
    });

    it("wire format: the exiled permanent is pinned to Aang's Iceberg for both viewers", () => {
        const iceberg = makeInstance(aangsIceberg.id, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [iceberg] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, iceberg);
        chooseIcebergTarget(state, "target");
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiledCard = projected.players[1].exile.find(
                (c) => c.id === "target"
            )!;
            expect(exiledCard.exiledByPermanentId).toBe("iceberg");
        }
    });
});
