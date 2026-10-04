// Bot-play sweep (issue #4839) — a spell that exiles a creature its controller
// owns and returns it to the battlefield (CR 400.7, CR 603.6a) is posed with a
// creature on the caster's side whose enters trigger the blink replays.
// Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { blinkPose } from "../botReachBlink";

describe("blinkPose", () => {
    it("poses a creature on the caster's battlefield for Ephemerate", () => {
        const pose = blinkPose(getCardByName("Ephemerate")!);
        expect(pose.length).toBeGreaterThan(0);
        for (const card of pose) {
            expect(card).toMatchObject({ owner: "me", zone: "battlefield" });
        }
    });

    it("poses nothing for a spell that returns nothing to the battlefield", () => {
        expect(blinkPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a blink spell", () => {
    it("plays Ephemerate against a creature whose enters trigger is worth replaying", () => {
        const verdict = playBotReach(getCardByName("Ephemerate")!);
        expect(verdict.outcome).toBe("played");
    });
});
