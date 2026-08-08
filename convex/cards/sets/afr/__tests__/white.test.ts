// AFR (Adventures in the Forgotten Realms) — white card behavior tests
// (ADR 0043 colour split). Each card's describe block cites the CR section
// it exercises.
import { describe, it, expect } from "vitest";
import { portableHole } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";

// Black Lotus — {0} artifact, mv 0 ≤ 2, a legal Portable Hole target.
const CHEAP_ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe";

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "ph",
    controllerId: "p1",
    types: ["Artifact"],
} as StackItem["triggerEvent"];

function setup() {
    const ph = makeInstance(portableHole.id, {
        id: "ph",
        controllerId: "p1",
        ownerId: "p1",
    });
    const cheap = makeInstance(CHEAP_ARTIFACT_ID, {
        id: "cheap",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [ph] }),
            makePlayer("p2", { battlefield: [cheap] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, ph };
}

/** Puts Portable Hole's ETB trigger (`portable-hole-exile`) on the stack with
 *  its `triggerSourceId` set and NO target slot, mirroring the engine right
 *  after a targeted trigger is put on the stack (CR 603.3d). The trigger now
 *  carries a `targetRequirement`, so `raiseTriggerTargetSelection` runs before
 *  the trigger can resolve. */
function putTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "portable-hole-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "portable-hole-exile",
        triggerSourceId: source.id,
        triggerEvent: ETB_EVENT,
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery for the
 *  multi-candidate case: `raiseTriggerTargetSelection` raises the
 *  `kind:"trigger"` PendingTarget, then `finalizeTargetSelection` writes the
 *  chosen target onto the on-stack trigger. */
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

describe("Portable Hole (AFR — exile-until-leaves scoped to mv<=2, CR 603.6a/603.7a)", () => {
    it("single legal target auto-selects at stack placement, then exiles it (CR 603.3d)", () => {
        const { state, ph } = setup();
        const trig = putTriggerOnStack(state, ph);
        // Only one legal target (the opponent's mv-0 artifact) — the engine
        // locks it without raising a PendingTarget (CR 603.3d sole target).
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "cheap" }]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("cheap");
        const bundle = state.exileHeld?.find((b) => b.sourceId === "ph");
        expect(bundle?.hostId).toBe("cheap");
    });

    it("with 2+ legal targets, raises a PendingTarget and exiles the chosen one (CR 603.3d)", () => {
        const { state, ph } = setup();
        const cheap2 = makeInstance(CHEAP_ARTIFACT_ID, {
            id: "cheap2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(cheap2);
        putTriggerOnStack(state, ph);
        chooseTarget(state, "cheap");
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("cheap");
        // The unchosen legal target is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap2")
        ).toBeDefined();
        const bundle = state.exileHeld?.find((b) => b.sourceId === "ph");
        expect(bundle?.hostId).toBe("cheap");
    });

    it("returns the exiled permanent when Portable Hole leaves (CR 603.7a)", () => {
        const { state, ph } = setup();
        const trig = putTriggerOnStack(state, ph);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "cheap" }]);
        resolveTopOfStack(state);

        removePermanentTo(state, "ph", "graveyard");
        processPendingActionTriggers(state);
        const returnTrig = state.stack.find(
            (s) => s.triggeredAbilityId === "portable-hole-return"
        );
        expect(returnTrig).toBeDefined();
        resolveTopOfStack(state);

        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap")
        ).toBeDefined();
        expect(state.exileHeld ?? []).toHaveLength(0);
        checkStateBasedActions(state);
    });

    it("wire: the exiled permanent is pinned to Portable Hole via exiledByPermanentId, for both viewers", () => {
        const { state, ph } = setup();
        putTriggerOnStack(state, ph);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiledCard = projected.players[1].exile.find(
                (c) => c.id === "cheap"
            )!;
            expect(exiledCard.exiledByPermanentId).toBe("ph");
        }
    });
});
