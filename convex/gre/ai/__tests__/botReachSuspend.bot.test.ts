// CR 118.6 / 702.62a — a card with no mana cost leaves the hand only through
// suspend, so the reach census must seed the lands its SUSPEND cost demands:
// seeded from its absent mana cost it held no coloured land, the suspend
// special action was never affordable, and the card read as a Bot Gap.

import { describe, expect, it } from "vitest";
import { resolveCardExport } from "../../../cards/defineCard";
import { livingEnd } from "../../../cards/sets/tsp/black.cards";
import { botReachSpec, playBotReach } from "../botReach";

const LIVING_END = resolveCardExport(livingEnd)!;

describe("bot reach funds a no-mana-cost card's suspend cost (CR 118.6, 702.62a)", () => {
    it("a Suspend 3—{2}{B}{B} card gets enough Swamps", () => {
        const names = botReachSpec(LIVING_END).cards.map((c) => c.name);
        expect(
            names.filter((n) => n === "Swamp").length
        ).toBeGreaterThanOrEqual(4);
    });

    it("the Bot plays it — it suspends the card", () => {
        expect(playBotReach(LIVING_END).outcome).toBe("played");
    });
});
