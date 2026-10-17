// Bot-play sweep (issue #5717) — a permanent that stops lands untapping
// (CR 502.3) is posed against an opponent whose lands are tapped, the state in
// which the lock denies mana. Verdicts go through the real `playBotReach`
// pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { untapLockPose } from "../botReachUntapLock";

describe("untapLockPose", () => {
    it("poses tapped opposing lands for Stasis", () => {
        const pose = untapLockPose(getCardByName("Stasis")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            owner: "opp",
            zone: "battlefield",
            tapped: true,
        });
    });

    it("poses nothing for a card that locks no land", () => {
        expect(untapLockPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });

    it("poses nothing for a lock scoped to one host creature", () => {
        // CR 502.3 — an Aura that keeps its host from untapping locks no land.
        expect(untapLockPose(getCardByName("Merseine")!)).toEqual([]);
    });
});

describe("playBotReach on a land lock", () => {
    it("plays Stasis against an opponent with tapped lands", () => {
        expect(playBotReach(getCardByName("Stasis")!).outcome).toBe("played");
    });
});
