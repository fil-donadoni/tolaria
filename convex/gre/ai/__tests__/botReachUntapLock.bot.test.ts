// Bot-play sweep (issue #5747) — a permanent that keeps every player's lands
// from untapping (CR 502.3) is posed against an opponent who tapped out, so
// the lock takes something from the opponent. Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
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

    it("reads the statics of a COMPILED definition, as the oracle sweep plays it", () => {
        const printed = getCardByName("Stasis")!;
        const compiled = {
            ...printed,
            id: "compiled-stasis-5747",
            staticEffects: undefined,
            compiledStaticEffects: [
                {
                    kind: "untap-restriction" as const,
                    id: "stasis-untap-lock",
                    oracleText: "Players skip their untap steps.",
                    filter: { types: ["Land" as const] },
                    maxUntap: 0,
                },
            ],
        };
        withTemporaryDefinition(compiled, () => {
            expect(untapLockPose(compiled)).toHaveLength(1);
        });
    });

    it("poses nothing for a card that locks no untap", () => {
        expect(untapLockPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });

    it("poses nothing for a creature carrying an untap restriction", () => {
        expect(untapLockPose(getCardByName("Grizzly Bears")!)).toEqual([]);
    });
});

describe("playBotReach on a symmetric untap lock", () => {
    it("plays Stasis against an opponent whose lands stay tapped", () => {
        const verdict = playBotReach(getCardByName("Stasis")!);
        expect(verdict.outcome).toBe("played");
    });
});
