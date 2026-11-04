// CR 702.114a — a devoid card is colourless but still costs its coloured pips,
// so the reach census must seed the lands its COST demands: seeded from its
// colour it would hold Plains and never be castable, reading as a Bot Gap.

import { describe, expect, it } from "vitest";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { botReachSpec } from "../botReach";

describe("bot reach seeds a devoid card's castable lands (CR 702.114a)", () => {
    it("a colourless {1}{G} card gets Forests", () => {
        const names = botReachSpec({
            ...grizzlyBears(),
            staticAbilities: ["devoid"],
        }).cards.map((c) => c.name);
        expect(names).toContain("Forest");
        expect(names).not.toContain("Plains");
    });
});
