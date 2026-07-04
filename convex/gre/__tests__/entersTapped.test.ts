// CR 614.1c — a permanent's own `entersTapped` / `entersTappedUnless`
// (issue #675) evaluated at the LAND-PLAY site (`applyPlayLand`), distinct
// from the pre-existing `describe("entersTapped", ...)` in `targeting.test.ts`
// which only covers a CAST spell resolving through the stack. `applyPlayLand`
// previously never consulted a card's `entersTapped` flag at all — this file
// locks in the fix.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { applyPlayLand } from "../playLand";

describe("entersTapped / entersTappedUnless at land-play (CR 614.1c)", () => {
    it("a land with entersTapped: true enters tapped when played", () => {
        // Havenwood Battleground (FEM) — "This land enters tapped."
        const HAVENWOOD_BATTLEGROUND = "9028f200-80dd-4c53-877f-ea380ff417cb";
        const land = makeInstance(HAVENWOOD_BATTLEGROUND, { zone: "hand" });
        const player = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, land.id);

        expect(played.isTapped).toBe(true);
    });

    it("a fast land enters untapped with two or fewer other lands", () => {
        // Copperline Gorge (SOM) — "enters tapped unless you control two or
        // fewer other lands" — makeDualLand({ fastLand: true }).
        const COPPERLINE_GORGE = "28f1d784-f286-418d-a712-bc07ad10d4a2";
        const otherLand1 = makeInstance(
            "9028f200-80dd-4c53-877f-ea380ff417cb",
            { zone: "battlefield" }
        );
        const otherLand2 = makeInstance(
            "9028f200-80dd-4c53-877f-ea380ff417cb",
            { zone: "battlefield" }
        );
        const fastLand = makeInstance(COPPERLINE_GORGE, { zone: "hand" });
        const player = makePlayer("p1", {
            hand: [fastLand],
            battlefield: [otherLand1, otherLand2],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, fastLand.id);

        expect(played.isTapped).toBe(false);
    });

    it("a fast land enters tapped with three or more other lands", () => {
        const COPPERLINE_GORGE = "28f1d784-f286-418d-a712-bc07ad10d4a2";
        const others = [0, 1, 2].map(() =>
            makeInstance("9028f200-80dd-4c53-877f-ea380ff417cb", {
                zone: "battlefield",
            })
        );
        const fastLand = makeInstance(COPPERLINE_GORGE, { zone: "hand" });
        const player = makePlayer("p1", {
            hand: [fastLand],
            battlefield: others,
        });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, fastLand.id);

        expect(played.isTapped).toBe(true);
    });
});
