// Bot-play sweep — a spell that returns up to X cards from the holder's
// graveyard, X counted on the opponent's battlefield when it is cast
// (CR 601.2c, CR 107.3), is posed with permanents of the counted colour on the
// opponent's side. Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { countedReturnPose } from "../botReachCountedReturn";

describe("countedReturnPose", () => {
    it("poses black permanents for the opponent and a graveyard for Reap", () => {
        const pose = countedReturnPose(getCardByName("Reap")!);
        expect(pose).toHaveLength(2);
        expect(pose[0]).toMatchObject({
            name: "Black Knight",
            owner: "opp",
            zone: "battlefield",
        });
        expect(pose[1]).toMatchObject({ owner: "me", zone: "graveyard" });
    });

    it("poses nothing for a spell with no counted target group", () => {
        expect(countedReturnPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a counted graveyard return", () => {
    it("plays Reap against an opponent holding black permanents", () => {
        const verdict = playBotReach(getCardByName("Reap")!);
        expect(verdict.outcome).toBe("played");
    });
});
