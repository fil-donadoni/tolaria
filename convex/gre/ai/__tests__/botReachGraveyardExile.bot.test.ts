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
        // Seed-split, not valuation (issue #3981): over seeds 1–20 the cast is
        // chosen on 8, the same 8 under the weights before and after that
        // refit — but the two default seeds (0xb07, 0x5eed) played it before
        // and not after. Twenty seeds read the pose, not the dice.
        const verdict = playBotReach(getCardByName("Haunting Echoes")!, {
            ...BOT_REACH_BUDGET,
            seeds: Array.from({ length: 20 }, (_, i) => i + 1),
        });
        expect(verdict.outcome).toBe("played");
    });
});
