// Bot-play sweep (issue #4826) — a permanent whose end-step trigger destroys
// every permanent of a subtype (CR 603.6a, CR 701.8) is posed against an
// opposing board of that subtype, so the sweep is a trade rather than a pure
// loss. Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { subtypeSweepPose } from "../botReachSubtypeSweep";

describe("subtypeSweepPose", () => {
    it("poses opposing creatures of the swept subtype", () => {
        const pose = subtypeSweepPose(getCardByName("Goblin Pyromancer")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({ owner: "opp", zone: "battlefield" });
    });

    it("poses nothing for a card that sweeps no subtype", () => {
        expect(subtypeSweepPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a subtype sweep", () => {
    it("plays Goblin Pyromancer against a board of Goblins", () => {
        const verdict = playBotReach(getCardByName("Goblin Pyromancer")!);
        expect(verdict.outcome).toBe("played");
    });
});
