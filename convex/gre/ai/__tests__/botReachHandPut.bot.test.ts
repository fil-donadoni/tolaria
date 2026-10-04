// Bot-play sweep (issue #4824) — a card that lets players put a creature card
// from hand onto the battlefield is posed with a creature the lands cannot
// cast (CR 608.2d: "may put" is a legal decline, so with nothing to put the
// caster only gifts the opponent a permanent). Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { handPutPose } from "../botReachHandPut";

describe("handPutPose", () => {
    it("hands a hand-put sorcery a creature its lands cannot cast", () => {
        expect(handPutPose(getCardByName("Show and Tell")!, 5)).toEqual([
            { name: "Force of Nature", owner: "me", zone: "hand" },
        ]);
    });

    it("poses nothing for a card with no hand put", () => {
        expect(handPutPose(getCardByName("Lightning Bolt")!, 5)).toEqual([]);
    });
});

describe("playBotReach on a hand put", () => {
    it("plays Show and Tell once there is a creature to put in", () => {
        const verdict = playBotReach(getCardByName("Show and Tell")!);
        expect(verdict.outcome).toBe("played");
    });
});
