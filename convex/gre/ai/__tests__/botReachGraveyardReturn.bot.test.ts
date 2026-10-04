// Bot-play sweep (issue #4830) — a spell that returns every card of a type from
// the holder's graveyard to the battlefield (CR 404.1, CR 400.7) is posed with
// such cards in that graveyard. Verdicts go through the real `playBotReach`
// pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { graveyardReturnPose } from "../botReachGraveyardReturn";

describe("graveyardReturnPose", () => {
    it("poses enchantments in the holder's graveyard for Replenish", () => {
        const pose = graveyardReturnPose(getCardByName("Replenish")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            name: "Castle",
            owner: "me",
            zone: "graveyard",
        });
    });

    it("poses nothing for a spell that leaves graveyards alone", () => {
        expect(graveyardReturnPose(getCardByName("Lightning Bolt")!)).toEqual(
            []
        );
    });
});

describe("playBotReach on a graveyard return", () => {
    it("plays Replenish against a graveyard worth returning", () => {
        const verdict = playBotReach(getCardByName("Replenish")!);
        expect(verdict.outcome).toBe("played");
    });
});
