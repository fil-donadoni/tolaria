// Bot-play sweep (issue #4832) — a spell that searches the holder's library
// and puts the card onto the battlefield (CR 701.23a), on top of it, or into
// the hand (issue #8854) is posed with a card the search can take in that
// library. Verdicts go through the real
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

    // Issue #4843 — a search that puts the card on top of the library is
    // posed with a card BELOW the top, so the swap changes the next draw.
    it("poses a card below the top for a put-on-top search with no filter", () => {
        const pose = libraryPutPose(getCardByName("Imperial Seal")!);
        expect(pose).toHaveLength(1);
        expect(pose[0]).toMatchObject({
            owner: "me",
            zone: "library",
            position: 2,
        });
    });

    // Issue #8854 — a search into the HAND is posed with a card the holder's
    // lands can cast once the spell (or a delayed payment) is paid for.
    it("poses the strongest castable match for a hand tutor", () => {
        const lands = Array<string>(6).fill("Forest");
        const pose = libraryPutPose(getCardByName("Eladamri's Call")!, lands);
        expect(pose).toEqual([
            { name: "Juggernaut", owner: "me", zone: "library", position: 1 },
        ]);
    });

    it("reads the lands a Pact's upkeep payment leaves for the find", () => {
        const lands = [...Array<string>(4).fill("Forest"), "Plains", "Plains"];
        const pose = libraryPutPose(getCardByName("Summoner's Pact")!, lands);
        expect(pose).toEqual([
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "library",
                position: 1,
            },
        ]);
    });

    it("poses nothing for a hand tutor the lands cannot follow up", () => {
        expect(libraryPutPose(getCardByName("Summoner's Pact")!, [])).toEqual(
            []
        );
    });

    it("poses nothing for a search split into per-category filters", () => {
        expect(libraryPutPose(getCardByName("Gaea's Balance")!)).toEqual([]);
    });

    it("poses nothing for a spell that searches no library", () => {
        expect(libraryPutPose(getCardByName("Lightning Bolt")!)).toEqual([]);
    });
});

describe("playBotReach on a library search", () => {
    it.each([
        "Natural Order",
        "Tinker",
        "Imperial Seal",
        // Issue #8854 — a tutor Pact: payment lands, a castable find, and no
        // game-losing decline branch in the tree.
        "Summoner's Pact",
        // A tutor that reveals its find before putting it into the hand.
        "Gaea's Bounty",
    ])("plays %s", (name) => {
        expect(playBotReach(getCardByName(name)!).outcome).toBe("played");
    });
});
