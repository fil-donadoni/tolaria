// eve (Eventide) — per-card behavior tests for white cards in
// `convex/cards/sets/eve/white.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { flickerwisp } from "../white";
import { balduvianBears } from "../../ice/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
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

describe("Flickerwisp (CR 603.6a exile + CR 603.7a delayed return, next end step)", () => {
    it("is a {1}{W}{W} 3/1 Elemental with flying", () => {
        expect(flickerwisp.manaCost).toEqual({ X: 1, W: 2 });
        expect(flickerwisp.power).toBe(3);
        expect(flickerwisp.toughness).toBe(1);
        expect(flickerwisp.staticAbilities).toEqual(["flying"]);
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
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        submitChoice(state, ["target"]);
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
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        submitChoice(state, ["target"]);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
        ).toBeDefined();
        expect(
            state.players[1].exile.find((c) => c.id === "target")
        ).toBeUndefined();
    });

    it("does not target itself (CR 608.2b — 'another target permanent')", () => {
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
        // No legal candidate other than itself — CR 608.2b, no-op.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "wisp")
        ).toBeDefined();
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
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushEtbTrigger(state, wisp);
        submitChoice(state, ["target"]);
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
