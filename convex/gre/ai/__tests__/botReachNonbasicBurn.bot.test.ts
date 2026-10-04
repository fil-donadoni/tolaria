// Bot-play sweep (issue #4828) — a spell dealing damage by each player's
// nonbasic lands (CR 305.6) is posed against an opponent who controls some.
// Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { nonbasicBurnPose } from "../botReachNonbasicBurn";

describe("nonbasicBurnPose", () => {
    it("poses opposing nonbasic lands for Price of Progress", () => {
        const pose = nonbasicBurnPose(getCardByName("Price of Progress")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({ owner: "opp", zone: "battlefield" });
    });

    it("poses nothing for a burn spell that counts no lands", () => {
        expect(nonbasicBurnPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on nonbasic-land burn", () => {
    it("plays Price of Progress against an opponent with nonbasic lands", () => {
        const verdict = playBotReach(getCardByName("Price of Progress")!);
        expect(verdict.outcome).toBe("played");
    });
});
