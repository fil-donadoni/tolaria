// Bot-play sweep (issue #4829) — a spell that exiles a player's graveyard
// (CR 404.1) is posed against an opponent whose graveyard holds a card it can
// cast from there. Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { BOT_REACH_BUDGET, playBotReach } from "../botReach";
import { graveyardExilePose } from "../botReachGraveyardExile";

describe("graveyardExilePose", () => {
    it("poses an opposing graveyard card for Haunting Echoes", () => {
        const pose = graveyardExilePose(getCardByName("Haunting Echoes")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({ owner: "opp", zone: "graveyard" });
    });

    it("poses nothing for a spell that leaves graveyards alone", () => {
        expect(graveyardExilePose(getCardByName("Lightning Bolt")!)).toEqual(
            []
        );
    });
});

describe("playBotReach on graveyard exile", () => {
    it("plays Haunting Echoes against a graveyard worth exiling", () => {
        // Seed-split, not valuation (issue #3981): the cast is chosen on 8 of
        // seeds 1–20 at one seat or the other, identically under the weights
        // before and after that refit, and the two default seeds happened to
        // be among them before it. Twenty seeds read the pose, not the dice.
        const verdict = playBotReach(getCardByName("Haunting Echoes")!, {
            ...BOT_REACH_BUDGET,
            seeds: Array.from({ length: 20 }, (_, i) => i + 1),
        });
        expect(verdict.outcome).toBe("played");
    });
});
