// Bot-play sweep — a creature whose activated ability sacrifices a creature to
// deal damage (CR 602.2, CR 120.3) is posed with spare bodies to
// sacrifice and small creatures for the damage to remove. Verdicts go through
// the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { sacOutletPose } from "../botReachSacOutlet";

describe("sacOutletPose", () => {
    it("poses bodies on both sides for Krovikan Horror", () => {
        const pose = sacOutletPose(getCardByName("Krovikan Horror")!);
        expect(pose.map((c) => c.owner).sort()).toEqual(["me", "opp"]);
        expect(pose.every((c) => c.zone === "battlefield")).toBe(true);
    });

    it("poses nothing for a creature with no sacrifice-for-damage ability", () => {
        expect(sacOutletPose(getCardByName("Grizzly Bears")!)).toEqual([]);
    });
});

describe("playBotReach on a creature that sacrifices creatures for damage", () => {
    it("plays Krovikan Horror beside fodder and a target", () => {
        const verdict = playBotReach(getCardByName("Krovikan Horror")!);
        expect(verdict.outcome).toBe("played");
    });
});
