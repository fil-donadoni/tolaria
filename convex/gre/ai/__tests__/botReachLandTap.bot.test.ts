// Bot-play sweep (issue #4827) — a spell that taps every land a target player
// controls (CR 701.26a) is posed against an opponent who has lands to tap.
// Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { landTapPose } from "../botReachLandTap";

describe("landTapPose", () => {
    it("poses untapped opposing lands for Mana Short", () => {
        const pose = landTapPose(getCardByName("Mana Short")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({ owner: "opp", zone: "battlefield" });
    });

    it("poses nothing for a card that taps no lands", () => {
        expect(landTapPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a land tapper", () => {
    it("plays Mana Short against an opponent with lands", () => {
        const verdict = playBotReach(getCardByName("Mana Short")!);
        expect(verdict.outcome).toBe("played");
    });
});
