// Bot-play sweep (issue #4832) — a spell that searches the holder's library
// and puts the card onto the battlefield (CR 701.23a) is posed with a card the
// search can take in that library. Verdicts go through the real
// `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { libraryPutPose } from "../botReachLibraryPut";

describe("libraryPutPose", () => {
    it("poses a green creature in the library for Natural Order", () => {
        const pose = libraryPutPose(getCardByName("Natural Order")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            name: "Craw Wurm",
            owner: "me",
            zone: "library",
        });
    });

    it("poses an artifact in the library for Tinker", () => {
        const pose = libraryPutPose(getCardByName("Tinker")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            name: "Juggernaut",
            owner: "me",
            zone: "library",
        });
    });

    it("poses nothing for a spell that searches no library", () => {
        expect(libraryPutPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a library search", () => {
    it.each(["Natural Order", "Tinker"])("plays %s", (name) => {
        expect(playBotReach(getCardByName(name)!).outcome).toBe("played");
    });
});
