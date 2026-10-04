// Bot-play sweep (issue #4831) — a spell that destroys or equalizes creatures
// for every player (CR 701.8a, CR 701.21a) is posed against an opposing board
// ahead of the caster's. Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { creatureSweepPose } from "../botReachCreatureSweep";

describe("creatureSweepPose", () => {
    it("poses extra opposing creatures for Damnation", () => {
        const pose = creatureSweepPose(getCardByName("Damnation")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            name: "Grizzly Bears",
            owner: "opp",
            zone: "battlefield",
        });
    });

    it("poses opposing lands too for an equalizer", () => {
        const pose = creatureSweepPose(getCardByName("Balance")!);
        expect(pose.map((c) => c.name)).toEqual(["Grizzly Bears", "Plains"]);
    });

    it("poses nothing for a spell that leaves creatures alone", () => {
        expect(creatureSweepPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a creature sweep", () => {
    it.each(["Damnation", "Balance"])("plays %s", (name) => {
        expect(playBotReach(getCardByName(name)!).outcome).toBe("played");
    });
});
