// clu — per-card behavior tests for red cards in
// `convex/cards/sets/clu/red.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { headlinerScarlett } from "../red";
import { balduvianBears } from "../../ice/green";
import { forest, mountain } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPlayLandFromExile } from "../../../../gre/playLand";
import { getLegalActions, assertLegalAction } from "../../../../gre/rules";
import { finalizeCleanup } from "../../../../gre/phases";
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
        // CR 514.2 / 608.2g — "play that card THIS TURN": the grant is stamped
        // with the current turn number so CLEANUP revokes it at end of turn.
        expect(exiled.castableFromExileUntilTurn).toBe(state.turn);
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

/** Whole-class primitive behavior for the play-from-exile permission
 *  (`grantCastFromExile`): turn-scoped expiry at CLEANUP and land-play routing.
 *  Exercised through Headliner Scarlett's real upkeep trigger, but the fixes are
 *  class-level (Expressive Iteration, any "you may play" impulse card shares
 *  them). CR 514.2 (cleanup), CR 608.2g (this-turn window), CR 305.2 (land
 *  drop). Issue #946. */
describe("play-from-exile expiry + land-play (CR 514.2 / 608.2g / 305.2)", () => {
    /** Exiled instance carrying a play-from-exile grant. `untilTurn` set →
     *  turn-scoped ("this turn"); omitted → persisted ("as long as it remains
     *  exiled"). */
    function exiledWithGrant(
        cardId: string,
        opts: { untilTurn?: number } = {}
    ) {
        const card = makeInstance(cardId, {
            id: "exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            knownTo: ["p1"],
            castableFromExileBy: "p1",
            ...(opts.untilTurn !== undefined
                ? { castableFromExileUntilTurn: opts.untilTurn }
                : {}),
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [card] }), makePlayer("p2")],
            activePlayerId: "p1",
            turn: 1,
        });
        return { state, card };
    }

    it("a this-turn grant is revoked at CLEANUP while the card stays exiled", () => {
        const { state, card } = exiledWithGrant(balduvianBears.id, {
            untilTurn: 1,
        });
        finalizeCleanup(state);
        // Still exiled — only the permission expires (CR 514.2), not the card.
        expect(state.players[0].exile).toHaveLength(1);
        expect(card.castableFromExileBy).toBeUndefined();
        expect(card.castableFromExileUntilTurn).toBeUndefined();
    });

    it("a persisted grant (no expiry marker) is unaffected by CLEANUP (Ice Cauldron / Robber)", () => {
        const { state, card } = exiledWithGrant(balduvianBears.id);
        finalizeCleanup(state);
        expect(card.castableFromExileBy).toBe("p1");
        expect(card.castableFromExileUntilTurn).toBeUndefined();
    });

    it("a future-turn grant survives THIS cleanup and expires at the later one", () => {
        // untilTurn = 2 models "until end of your next turn" (out of scope to
        // ship, but the primitive must express it): turn 1 cleanup keeps it.
        const { state, card } = exiledWithGrant(balduvianBears.id, {
            untilTurn: 2,
        });
        finalizeCleanup(state);
        expect(card.castableFromExileBy).toBe("p1");
        state.turn = 2;
        finalizeCleanup(state);
        expect(card.castableFromExileBy).toBeUndefined();
    });

    it("an exiled land with play permission is a legal 'play' action (CR 305.2)", () => {
        const { state, card } = exiledWithGrant(forest.id, { untilTurn: 1 });
        const p1 = state.players[0];
        expect(getLegalActions(state, p1, card)).toContain("play");
        expect(getLegalActions(state, p1, card)).not.toContain("cast");
        expect(() => assertLegalAction(state, p1, card, "play")).not.toThrow();
    });

    it("playing an exiled land moves it to the battlefield, consumes the land drop, and blocks a second play", () => {
        const forestCard = makeInstance(forest.id, {
            id: "exiled-forest",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            knownTo: ["p1"],
            castableFromExileBy: "p1",
            castableFromExileUntilTurn: 1,
        });
        const mountainCard = makeInstance(mountain.id, {
            id: "exiled-mountain",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            knownTo: ["p1"],
            castableFromExileBy: "p1",
            castableFromExileUntilTurn: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { exile: [forestCard, mountainCard] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 1,
        });
        const p1 = state.players[0];

        applyPlayLandFromExile(state, p1, "exiled-forest");

        // Moved exile → battlefield; permission consumed.
        expect(p1.exile.map((c) => c.id)).toEqual(["exiled-mountain"]);
        expect(p1.battlefield.map((c) => c.id)).toContain("exiled-forest");
        expect(forestCard.castableFromExileBy).toBeUndefined();
        expect(forestCard.castableFromExileUntilTurn).toBeUndefined();
        // CR 305.2 — the land drop is spent.
        expect(p1.landsPlayedThisTurn).toBe(1);
        // A second exiled land can no longer be played this turn.
        expect(getLegalActions(state, p1, mountainCard)).not.toContain("play");
    });

    it("integration: exile a land via Scarlett's upkeep, playable this turn, blocked next turn (GRE → projection)", () => {
        const scarlett = makeInstance(headlinerScarlett.id, {
            id: "scarlett",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topLand = makeInstance(forest.id, {
            id: "top-land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [scarlett],
                    library: [topLand],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 1,
        });
        pushTrigger(
            state,
            scarlett,
            "headliner-scarlett-upkeep",
            upkeepEvent("p1")
        );

        // Wire boundary: the controller's projected exile card surfaces "play"
        // (it's a land), not "cast".
        const projectedNow = projectPublicState(state, 1, "p1");
        const slimNow = projectedNow.players[0].exile.find(
            (c) => c.id === "top-land"
        )!;
        expect(slimNow.legalActions).toContain("play");
        expect(slimNow.legalActions).not.toContain("cast");

        // The land is playable this turn — the exact path playCard takes.
        expect(
            getLegalActions(state, state.players[0], state.players[0].exile[0])
        ).toContain("play");

        // End the turn (CR 514.2): the this-turn grant is revoked and the
        // projection stops surfacing any legal action for the still-exiled land.
        finalizeCleanup(state);
        const exiledAfter = state.players[0].exile.find(
            (c) => c.id === "top-land"
        )!;
        expect(exiledAfter.castableFromExileBy).toBeUndefined();
        const projectedNext = projectPublicState(state, 2, "p1");
        const slimNext = projectedNext.players[0].exile.find(
            (c) => c.id === "top-land"
        )!;
        expect(slimNext.legalActions).toBeUndefined();
    });
});
