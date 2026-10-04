// Bot-play sweep (issue #4833) — a spell that has every player shuffle their
// hand into their library and draw a fresh hand (CR 121.1, CR 701.24a) is
// posed against a library holding spells. Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { handRefillSpell } from "../botReachHandRefill";

describe("handRefillSpell", () => {
    it.each(["Timetwister", "Echo of Eons", "Wheel of Fortune"])(
        "recognises %s",
        (name) => {
            expect(handRefillSpell(getCardByName(name)!)).toBe(true);
        }
    );

    it("recognises no spell that refills no hand", () => {
        expect(handRefillSpell(getCardByName("Lightning Bolt")!)).toBe(false);
    });
});

describe("playBotReach on a hand refill", () => {
    it.each(["Timetwister", "Echo of Eons", "Wheel of Fortune"])(
        "plays %s",
        (name) => {
            expect(playBotReach(getCardByName(name)!).outcome).toBe("played");
        }
    );
});
