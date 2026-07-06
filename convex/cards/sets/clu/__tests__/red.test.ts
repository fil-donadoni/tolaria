// clu — per-card behavior tests for red cards in
// `convex/cards/sets/clu/red.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { headlinerScarlett } from "../red";
import { balduvianBears } from "../../ice/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
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

function upkeepEvent(activePlayerId: string): StackItem["triggerEvent"] {
    return { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId };
}

function pushTrigger(
    state: GameState,
    scarlett: ReturnType<typeof makeInstance>,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
) {
    state.stack.push({
        ...scarlett,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId,
        triggerSourceId: scarlett.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Headliner Scarlett (CR 603.6a ETB block-lock + CR 603.6a upkeep impulse)", () => {
    it("is a {3}{R} 3/3 Legendary Human Warlock with haste", () => {
        expect(headlinerScarlett.manaCost).toEqual({ X: 3, R: 1 });
        expect(headlinerScarlett.power).toBe(3);
        expect(headlinerScarlett.toughness).toBe(3);
        expect(headlinerScarlett.staticAbilities).toEqual(["haste"]);
        expect(headlinerScarlett.supertypes).toEqual(["Legendary"]);
    });

    it("ETB sets every opposing creature to can't block this turn", () => {
        const scarlett = makeInstance(headlinerScarlett.id, {
            id: "scarlett",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker1 = makeInstance(balduvianBears.id, {
            id: "blocker1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeInstance(balduvianBears.id, {
            id: "blocker2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scarlett] }),
                makePlayer("p2", { battlefield: [blocker1, blocker2] }),
            ],
        });
        pushTrigger(
            state,
            scarlett,
            "headliner-scarlett-etb",
            etbEvent("scarlett")
        );
        expect(blocker1.cantBlockThisTurn).toBe(true);
        expect(blocker2.cantBlockThisTurn).toBe(true);
    });

    it("upkeep trigger exiles the top library card face down, castable by the controller", () => {
        const scarlett = makeInstance(headlinerScarlett.id, {
            id: "scarlett",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(balduvianBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scarlett], library: [top] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        pushTrigger(
            state,
            scarlett,
            "headliner-scarlett-upkeep",
            upkeepEvent("p1")
        );
        expect(state.players[0].library).toHaveLength(0);
        const exiled = state.players[0].exile.find((c) => c.id === "top")!;
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.knownTo).toEqual(["p1"]);
    });

    it("upkeep trigger is a no-op with an empty library", () => {
        const scarlett = makeInstance(headlinerScarlett.id, {
            id: "scarlett",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scarlett], library: [] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        pushTrigger(
            state,
            scarlett,
            "headliner-scarlett-upkeep",
            upkeepEvent("p1")
        );
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("wire format: the exiled card is castable-from-exile for both viewers", () => {
        const scarlett = makeInstance(headlinerScarlett.id, {
            id: "scarlett",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(balduvianBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scarlett], library: [top] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        pushTrigger(
            state,
            scarlett,
            "headliner-scarlett-upkeep",
            upkeepEvent("p1")
        );
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].exile.find(
                (c) => c.id === "top"
            )!;
            expect(slim.castableFromExileBy).toBe("p1");
        }
    });
});
