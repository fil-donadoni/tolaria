// Bot-play sweep (issue #4845) — a spell paid only by delve and convoke
// (CR 702.66, CR 702.51, CR 601.2f) is posed with graveyard fodder and
// creatures to tap. Verdicts go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { costAlternativesPose } from "../botReachCostAlternatives";

describe("costAlternativesPose", () => {
    it("poses delve fodder and convoke creatures for Hogaak", () => {
        const pose = costAlternativesPose(
            getCardByName("Hogaak, Arisen Necropolis")!
        );
        expect(pose).toEqual([
            expect.objectContaining({ zone: "graveyard", count: 5 }),
            expect.objectContaining({ zone: "battlefield", count: 2 }),
        ]);
    });

    it("poses nothing for a spell paid with mana", () => {
        expect(costAlternativesPose(getCardByName("Grizzly Bears")!)).toEqual(
            []
        );
    });
});

describe("playBotReach on a delve-and-convoke creature", () => {
    it("plays Hogaak against fodder and creatures to tap", () => {
        const verdict = playBotReach(
            getCardByName("Hogaak, Arisen Necropolis")!
        );
        expect(verdict.outcome).toBe("played");
    });
});
