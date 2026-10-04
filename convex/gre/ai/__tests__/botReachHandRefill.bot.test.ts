// Bot-play sweep (issue #4833) — a spell that has every player shuffle their
// hand into their library and draw a fresh hand (CR 121.1, CR 701.24a) is
// posed against an opponent who already holds a full hand. Verdicts go through
// the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { handRefillOpponentHand } from "../botReachHandRefill";

describe("handRefillOpponentHand", () => {
    it.each(["Timetwister", "Echo of Eons"])(
        "fills the opponent's hand for %s",
        (name) => {
            expect(handRefillOpponentHand(getCardByName(name)!)).toBe(7);
        }
    );

    it("holds nothing for a spell that refills no hand", () => {
        expect(
            handRefillOpponentHand(getCardByName("Lightning Bolt")!)
        ).toBeUndefined();
    });
});

describe("playBotReach on a hand refill", () => {
    it.each(["Timetwister", "Echo of Eons"])("plays %s", (name) => {
        expect(playBotReach(getCardByName(name)!).outcome).toBe("played");
    });
});
