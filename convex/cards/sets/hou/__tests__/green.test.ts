// HOU — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { ramunapExcavator } from "../green";
import { grizzlyBears } from "../../lea/green";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    canPlayLandsFromGraveyard,
    getLegalActions,
} from "../../../../gre/rules";
import { applyPlayLandFromGraveyard } from "../../../../gre/playLand";

// Ramunap Excavator — {2}{G} Creature — Snake Cleric, 2/3. "You may play
// lands from your graveyard." (CR 305.1-analog player-wide permission, issue
// #1190 — read live off the battlefield, no GameState flag.)
describe("Ramunap Excavator (play lands from your graveyard, CR 305.1-analog — issue #1190)", () => {
    it("grants the permission while on the battlefield, and it flips false the instant it leaves (read live)", () => {
        const excavator = makeInstance(ramunapExcavator.id, {
            id: "excavator",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [excavator] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        expect(canPlayLandsFromGraveyard(state, player)).toBe(true);

        player.battlefield = [
            makeInstance(grizzlyBears.id, { controllerId: "p1" }),
        ];
        expect(canPlayLandsFromGraveyard(state, player)).toBe(false);
    });

    it("CR 305.2 — a graveyard land is playable, and spends the SINGLE land drop (no extra drop)", () => {
        const excavator = makeInstance(ramunapExcavator.id, {
            id: "excavator",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gyForest = makeInstance(forest.id, {
            id: "gy-forest",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const gyForest2 = makeInstance(forest.id, {
            id: "gy-forest-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [excavator],
                    graveyard: [gyForest, gyForest2],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 1,
        });
        const p1 = state.players[0];

        expect(getLegalActions(state, p1, gyForest)).toContain("play");
        applyPlayLandFromGraveyard(state, p1, "gy-forest");
        expect(p1.battlefield.map((c) => c.id)).toContain("gy-forest");
        expect(p1.landsPlayedThisTurn).toBe(1);

        // The one drop is spent — the second graveyard land is not playable.
        expect(getLegalActions(state, p1, gyForest2)).not.toContain("play");
    });
});
