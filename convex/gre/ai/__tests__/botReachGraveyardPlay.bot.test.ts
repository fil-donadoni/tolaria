// Bot-play sweep (issue #4835) — a spell that lets its controller play lands
// and cast spells from their graveyard this turn (CR 404.1, CR 601.2) is posed
// with such cards in that graveyard. Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { graveyardPlayPose } from "../botReachGraveyardPlay";

describe("graveyardPlayPose", () => {
    it("poses playable cards in the holder's graveyard for Yawgmoth's Will", () => {
        const pose = graveyardPlayPose(getCardByName("Yawgmoth's Will")!);
        expect(pose.length).toBeGreaterThan(0);
        for (const card of pose) {
            expect(card).toMatchObject({ owner: "me", zone: "graveyard" });
        }
    });

    it("poses nothing for a spell that grants no graveyard play", () => {
        expect(graveyardPlayPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a graveyard-play grant", () => {
    it("plays Yawgmoth's Will against a graveyard worth playing from", () => {
        const verdict = playBotReach(getCardByName("Yawgmoth's Will")!);
        expect(verdict.outcome).toBe("played");
    });
});
