// EOE — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { icetillExplorer, ouroboroid } from "../green";
import { grizzlyBears } from "../../lea/green";
import { forest, mountain } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getEffectivePower } from "../../../../gre/layers";
import {
    applyPlayLandFromGraveyard,
    applyPlayLand,
} from "../../../../gre/playLand";
import {
    assertLegalAction,
    canPlayLandsFromGraveyard,
    getExtraLandDrops,
    getLegalActions,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import type { PermanentEnteredEvent } from "../../../types";

// Ouroboroid — {2}{G}{G} Creature — Plant Wurm, 1/3 (CR 603.6a beginning-of-
// combat trigger; CR 122 counter placement; CR 608.2i X determined once).
// "At the beginning of combat on your turn, put X +1/+1 counters on each
// creature you control, where X is this creature's power."
describe("Ouroboroid (CR 603.6a beginning-of-combat trigger; CR 122 mass counters, X = source power)", () => {
    function setup(otherPower = 2, otherToughness = 2) {
        const ouro = makeInstance(ouroboroid.id, {
            id: "ouro",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A plain vanilla creature — NOT another Ouroboroid, so its own
        // beginning-of-combat trigger doesn't also fire and double the count.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            power: otherPower,
            toughness: otherToughness,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [ouro, other] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        return { state, ouro, other };
    }

    it("shape: 1/3 for {2}{G}{G} with the beginning-of-combat trigger declared", () => {
        expect(ouroboroid.manaCost).toEqual({ X: 2, G: 2 });
        expect(ouroboroid.power).toBe(1);
        expect(ouroboroid.toughness).toBe(3);
        expect(ouroboroid.triggeredAbilities).toHaveLength(1);
    });

    it("puts X (its own power, 1) +1/+1 counters on EACH creature you control, including itself", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const ouroLive = state.players[0].battlefield.find(
            (c) => c.id === "ouro"
        )!;
        const otherLive = state.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(ouroLive.counters?.["+1/+1"]).toBe(1);
        expect(otherLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, ouroLive)).toBe(2);
        expect(getEffectivePower(state, otherLive)).toBe(3);
    });

    it("does NOT put counters on an opponent's creature", () => {
        const { state, ouro } = setup();
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players.push(makePlayer("p2", { battlefield: [oppCreature] }));
        state.players[0].battlefield = [ouro];
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const oppLive = state.players[1].battlefield.find(
            (c) => c.id === "opp"
        )!;
        expect(oppLive.counters?.["+1/+1"]).toBeUndefined();
    });

    it("wire format: the mass +1/+1 counters survive projectPublicState", () => {
        const { state } = setup();
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const otherLive = projected.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(getEffectivePower(projected, otherLive)).toBe(3);
    });
});

// Icetill Explorer — {2}{G}{G} Creature — Insect Scout, 2/4 (issue #1190,
// Landfall CAP #694). Three independently-tested pieces: the extra land
// drop (CR 305.2), the unconditional play-lands-from-graveyard permission
// (CR 305.1-analog — the engine capability this issue ships), and the
// Landfall→mill trigger (CR 603.6a / 109.2, pure DSL `mill` Op).
describe("Icetill Explorer (extra land drop; play-lands-from-graveyard permission, issue #1190; Landfall→mill)", () => {
    function landEnteredEvent(
        instanceId: string,
        controllerId: string
    ): PermanentEnteredEvent {
        return {
            type: "PERMANENT_ENTERED",
            instanceId,
            controllerId,
            cardId: forest.id,
            types: ["Land"],
        } as PermanentEnteredEvent;
    }

    it("shape: {2}{G}{G} 2/4 with extraLandDrops, playsLandsFromGraveyard, and one Landfall trigger", () => {
        expect(icetillExplorer.manaCost).toEqual({ X: 2, G: 2 });
        expect(icetillExplorer.power).toBe(2);
        expect(icetillExplorer.toughness).toBe(4);
        expect(icetillExplorer.extraLandDrops).toBe(1);
        expect(icetillExplorer.playsLandsFromGraveyard).toBe(true);
        expect(icetillExplorer.triggeredAbilities).toHaveLength(1);
    });

    it("CR 305.2 — grants an extra land drop while on the battlefield", () => {
        const icetill = makeInstance(icetillExplorer.id, {
            id: "icetill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [icetill] });
        expect(getExtraLandDrops(player)).toBe(1);
    });

    it("Landfall — a land YOU control entering mills exactly 1 card", () => {
        const icetill = makeInstance(icetillExplorer.id, {
            id: "icetill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "land1",
            controllerId: "p1",
        });
        const topOfLibrary = makeInstance(mountain.id, {
            id: "lib-top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [icetill, land],
                    library: [topOfLibrary],
                }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [
            landEnteredEvent("land1", "p1"),
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const p1 = state.players[0];
        expect(p1.library).toHaveLength(0);
        expect(p1.graveyard.map((c) => c.id)).toContain("lib-top");
    });

    it("Landfall — an OPPONENT's land entering does NOT trigger (CR 109.2 — you control)", () => {
        const icetill = makeInstance(icetillExplorer.id, {
            id: "icetill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icetill] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            landEnteredEvent("oland", "p2"),
        ]);
        expect(triggers).toHaveLength(0);
    });

    describe("play-lands-from-graveyard permission (CR 305.1-analog, issue #1190)", () => {
        it("canPlayLandsFromGraveyard: true while Icetill Explorer is on the battlefield, false otherwise", () => {
            const icetill = makeInstance(icetillExplorer.id, {
                id: "icetill",
                controllerId: "p1",
                ownerId: "p1",
            });
            const withIcetill = makePlayer("p1", { battlefield: [icetill] });
            const stateWithIcetill = makeState({
                players: [withIcetill, makePlayer("p2")],
            });
            expect(
                canPlayLandsFromGraveyard(stateWithIcetill, withIcetill)
            ).toBe(true);

            const withoutIcetill = makePlayer("p1", {
                battlefield: [
                    makeInstance(grizzlyBears.id, { controllerId: "p1" }),
                ],
            });
            const stateWithoutIcetill = makeState({
                players: [withoutIcetill, makePlayer("p2")],
            });
            expect(
                canPlayLandsFromGraveyard(stateWithoutIcetill, withoutIcetill)
            ).toBe(false);
        });

        // NOTE: `getLegalActions`'s land branch is intentionally zone-agnostic
        // (mirrors the exile-land-play design — see Headliner Scarlett's test
        // suite, `sets/clu/__tests__/red.test.ts`): the STRUCTURAL timing/
        // land-drop check doesn't know or care which zone the passed-in card
        // instance lives in. The permission gate lives at the two call sites
        // that decide WHICH zone's card is even allowed to ask the question:
        // `findPlayableGraveyardLand` (game.ts, mutation-level source
        // resolution) and `projectGraveyardCard` (gameProjections.ts,
        // wire-level exposure — covered by the wire-format test below).

        it('a LAND in the graveyard HAS the "play" action while the permission is active', () => {
            const icetill = makeInstance(icetillExplorer.id, {
                id: "icetill",
                controllerId: "p1",
                ownerId: "p1",
            });
            const graveyardLand = makeInstance(forest.id, {
                id: "gy-land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [icetill],
                        graveyard: [graveyardLand],
                    }),
                    makePlayer("p2"),
                ],
            });
            const p1 = state.players[0];

            expect(getLegalActions(state, p1, graveyardLand)).toContain("play");
            expect(() =>
                assertLegalAction(state, p1, graveyardLand, "play")
            ).not.toThrow();
        });

        it("playing a graveyard land moves it to the battlefield, consumes the land drop, and blocks a second play once BOTH drops are spent", () => {
            const icetill = makeInstance(icetillExplorer.id, {
                id: "icetill",
                controllerId: "p1",
                ownerId: "p1",
            });
            const graveyardForest = makeInstance(forest.id, {
                id: "gy-forest",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const handMountain = makeInstance(mountain.id, {
                id: "hand-mountain",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [icetill],
                        graveyard: [graveyardForest],
                        hand: [handMountain],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                turn: 1,
            });
            const p1 = state.players[0];

            applyPlayLandFromGraveyard(state, p1, "gy-forest");
            // Icetill's OWN Landfall trigger fires off the land it just let us
            // play (it's a land the controller controls, CR 109.2) and lands
            // on the stack (triggers never auto-resolve) — resolve it so the
            // next sorcery-timing check sees an empty stack again.
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state);

            // Moved graveyard → battlefield; the CR 305.2 land drop is spent.
            expect(p1.graveyard.map((c) => c.id)).toEqual([]);
            expect(p1.battlefield.map((c) => c.id)).toContain("gy-forest");
            expect(p1.landsPlayedThisTurn).toBe(1);

            // Icetill's extraLandDrops: 1 grants a SECOND drop this turn — the
            // hand land is still playable.
            expect(getLegalActions(state, p1, handMountain)).toContain("play");
            applyPlayLand(state, p1, "hand-mountain");
            resolveTopOfStack(state); // second Landfall trigger, same reason.
            expect(p1.landsPlayedThisTurn).toBe(2);

            // Both drops spent now — a further land (hypothetically drawn) is
            // NOT playable.
            const anotherGraveyardLand = makeInstance(forest.id, {
                id: "gy-forest-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            p1.graveyard.push(anotherGraveyardLand);
            expect(
                getLegalActions(state, p1, anotherGraveyardLand)
            ).not.toContain("play");
        });

        it("canPlayLandsFromGraveyard flips false the instant Icetill Explorer leaves the battlefield (no stale flag — read live, not a GameState field)", () => {
            const icetill = makeInstance(icetillExplorer.id, {
                id: "icetill",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [icetill] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            expect(canPlayLandsFromGraveyard(state, player)).toBe(true);

            // Icetill leaves the battlefield (e.g. destroyed) — nothing to
            // clear on GameState; the permission is derived live every call.
            player.battlefield = [];
            expect(canPlayLandsFromGraveyard(state, player)).toBe(false);
        });

        it("wire format: a graveyard land carries legalActions:['play'] ONLY while Icetill Explorer is in play", () => {
            const icetill = makeInstance(icetillExplorer.id, {
                id: "icetill",
                controllerId: "p1",
                ownerId: "p1",
            });
            const graveyardLand = makeInstance(forest.id, {
                id: "gy-land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [icetill],
                        graveyard: [graveyardLand],
                    }),
                    makePlayer("p2"),
                ],
            });

            const projectedWithIcetill = projectPublicState(state, 1, "p1");
            const slimWithIcetill =
                projectedWithIcetill.players[0].graveyard.find(
                    (c) => c.id === "gy-land"
                )!;
            expect(slimWithIcetill.legalActions).toContain("play");
            expect(slimWithIcetill.castKind).toBeUndefined();

            // Icetill leaves — the projection stops surfacing the affordance.
            state.players[0].battlefield = [];
            const projectedWithout = projectPublicState(state, 2, "p1");
            const slimWithout = projectedWithout.players[0].graveyard.find(
                (c) => c.id === "gy-land"
            )!;
            expect(slimWithout.legalActions).toBeUndefined();

            // An OPPONENT viewing p1's graveyard never sees the affordance,
            // even while Icetill is in play (own-graveyard gate).
            state.players[0].battlefield = [icetill];
            const projectedOpponentView = projectPublicState(state, 3, "p2");
            const slimOpponentView =
                projectedOpponentView.players[0].graveyard.find(
                    (c) => c.id === "gy-land"
                )!;
            expect(slimOpponentView.legalActions).toBeUndefined();
        });
    });
});
