// Bot-play sweep (issue #4822) — a card that ADDS MANA is posed with a spell in
// hand that the lands alone cannot pay for (CR 106.1, CR 500.5: unspent mana
// empties at end of phase, so a ritual with nothing to spend on is rightly
// passed). Each verdict goes through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { manaSinkPose } from "../botReachMana";

describe("manaSinkPose", () => {
    it("hands a one-mana ritual a spell its three lands cannot pay for", () => {
        expect(manaSinkPose(getCardByName("Dark Ritual")!, 3)).toEqual([
            { name: "Sengir Vampire", owner: "me", zone: "hand" },
        ]);
    });

    it("hands a threshold ritual the sink its richer branch can pay for", () => {
        // Cabal Ritual's script is an `if`: {B}{B}{B}, or {B}{B}{B}{B}{B} at
        // threshold. The pose reads both branches, so the spell is reachable.
        expect(manaSinkPose(getCardByName("Cabal Ritual")!, 3)).toEqual([
            { name: "Sengir Vampire", owner: "me", zone: "hand" },
        ]);
    });

    it("poses nothing for a card that adds no mana", () => {
        expect(manaSinkPose(getCardByName("Lightning Bolt")!, 3)).toEqual([]);
    });

    it("poses nothing for a land (a mana ability, not a spell)", () => {
        expect(manaSinkPose(getCardByName("Swamp")!, 1)).toEqual([]);
    });
});

describe("playBotReach on a ritual", () => {
    it("plays Dark Ritual once there is a spell to pay for", () => {
        const verdict = playBotReach(getCardByName("Dark Ritual")!);
        expect(verdict.outcome).toBe("played");
    });

    it("plays Cabal Ritual, whose mana sits behind an `if`", () => {
        const verdict = playBotReach(getCardByName("Cabal Ritual")!);
        expect(verdict.outcome).toBe("played");
    });
});
