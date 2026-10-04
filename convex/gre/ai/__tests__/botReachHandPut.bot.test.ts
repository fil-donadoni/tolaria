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

    it("reaches past a creature the lands CAN cast (issue #4840)", () => {
        // Through the Breach is MV 5, so the sweep gives it 7 lands: Force of
        // Nature (MV 6) would be castable and the put would be pointless.
        expect(handPutPose(getCardByName("Through the Breach")!, 7)).toEqual([
            { name: "Scaled Wurm", owner: "me", zone: "hand" },
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

    it("plays Through the Breach once the creature outsizes the lands (issue #4840)", () => {
        const verdict = playBotReach(getCardByName("Through the Breach")!);
        expect(verdict.outcome).toBe("played");
    });
});
