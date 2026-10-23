// Bot-play sweep — a card whose script offers a may-pay GRAVEYARD leg
// (CR 118.3 / 118.12a, Harvest Wurm's "sacrifice it unless you return a basic
// land card from your graveyard to your hand") is posed with a card that pays
// the leg in the holder's graveyard. Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { mayPayGraveyardPose } from "../botReachMayPayGraveyard";
import { graveyardLegProbe } from "../../__tests__/fixtures/mayPayGraveyardLegProbe.fixture";

describe("mayPayGraveyardPose", () => {
    it("poses a basic land card for a basic-land-card graveyard leg", () => {
        expect(mayPayGraveyardPose(graveyardLegProbe)).toEqual([
            { name: "Forest", owner: "me", zone: "graveyard", count: 1 },
        ]);
    });

    it("poses nothing for a card with no graveyard leg", () => {
        expect(mayPayGraveyardPose(getCardByName("Lightning Bolt")!)).toEqual(
            []
        );
    });
});

describe("playBotReach on a may-pay graveyard leg", () => {
    it("plays the card against a graveyard that can pay its punisher", () => {
        const verdict = playBotReach(graveyardLegProbe);
        expect(verdict.outcome).toBe("played");
    });
});
