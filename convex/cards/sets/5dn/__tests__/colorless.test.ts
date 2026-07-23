// 5DN — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { crucibleOfWorlds } from "../colorless";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { canPlayLandsFromGraveyard } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";

// Crucible of Worlds — {3} Artifact. "You may play lands from your
// graveyard." Same CR 305.1-analog permission as Icetill Explorer / Ramunap
// Excavator, from a NON-creature source — the permission scan
// (`canPlayLandsFromGraveyard`) is card-type-agnostic.
describe("Crucible of Worlds (play lands from your graveyard, CR 305.1-analog — issue #1190)", () => {
    it("shape: {3} Artifact with playsLandsFromGraveyard and no other ability", () => {
        expect(crucibleOfWorlds.manaCost).toEqual({ X: 3 });
        expect(crucibleOfWorlds.types).toEqual(["Artifact"]);
        expect(crucibleOfWorlds.playsLandsFromGraveyard).toBe(true);
        expect(crucibleOfWorlds.triggeredAbilities ?? []).toHaveLength(0);
        expect(crucibleOfWorlds.activatedAbilities ?? []).toHaveLength(0);
    });

    it("an ARTIFACT source grants the permission, and it ends when the artifact leaves play", () => {
        const crucible = makeInstance(crucibleOfWorlds.id, {
            id: "crucible",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [crucible] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        expect(canPlayLandsFromGraveyard(state, player)).toBe(true);

        player.battlefield = [];
        expect(canPlayLandsFromGraveyard(state, player)).toBe(false);
    });

    it("wire format: a graveyard land carries legalActions:['play'] only while Crucible is in play, and never for the opponent's view", () => {
        const crucible = makeInstance(crucibleOfWorlds.id, {
            id: "crucible",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gyLand = makeInstance(forest.id, {
            id: "gy-land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [crucible],
                    graveyard: [gyLand],
                }),
                makePlayer("p2"),
            ],
        });

        const withCrucible = projectPublicState(state, 1, "p1");
        expect(
            withCrucible.players[0].graveyard.find((c) => c.id === "gy-land")!
                .legalActions
        ).toContain("play");

        // The opponent viewing p1's graveyard never sees the affordance.
        const opponentView = projectPublicState(state, 2, "p2");
        expect(
            opponentView.players[0].graveyard.find((c) => c.id === "gy-land")!
                .legalActions
        ).toBeUndefined();

        // Crucible leaves — the projection stops surfacing the affordance.
        state.players[0].battlefield = [];
        const withoutCrucible = projectPublicState(state, 3, "p1");
        expect(
            withoutCrucible.players[0].graveyard.find(
                (c) => c.id === "gy-land"
            )!.legalActions
        ).toBeUndefined();
    });
});
