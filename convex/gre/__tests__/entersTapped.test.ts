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
} from "../../cards/__tests__/setup.helper";
import { applyPlayLand } from "../playLand";
import type { CardInstanceState } from "../state";

describe("entersTapped / entersTappedUnless at land-play (CR 614.1c)", () => {
    it("a land with entersTapped: true enters tapped when played", () => {
        // Havenwood Battleground (FEM) — "This land enters tapped."
        const HAVENWOOD_BATTLEGROUND = "9028f200-80dd-4c53-877f-ea380ff417cb";
        const land = makeInstance(HAVENWOOD_BATTLEGROUND, { zone: "hand" });
        const player = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, land.id)!;

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

        const played = applyPlayLand(state, player, fastLand.id)!;

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

        const played = applyPlayLand(state, player, fastLand.id)!;

        expect(played.isTapped).toBe(true);
    });
});

// CR 614.1d — the JSON-pure `entersTappedUnlessControls` condition, read off a
// real card ("This land enters tapped unless you control a basic land"). What
// "you control" and "basic" mean here is the whole of the clause: the would-be
// controller's permanents (CR 109.5), by the live supertype (CR 205.4c).
describe("entersTappedUnlessControls at land-play (CR 614.1d)", () => {
    const ABANDONED_AIR_TEMPLE = "9c0433f9-8f1e-4a19-a83f-a41925f1b1a9";
    const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5";

    function played(mine: CardInstanceState[], theirs: CardInstanceState[]) {
        const land = makeInstance(ABANDONED_AIR_TEMPLE, { zone: "hand" });
        const player = makePlayer("p1", { battlefield: mine, hand: [land] });
        const state = makeState({
            players: [player, makePlayer("p2", { battlefield: theirs })],
        });
        return applyPlayLand(state, player, land.id)!;
    }

    function island(controllerId: string, fields = {}) {
        return makeInstance(ISLAND, {
            controllerId,
            ownerId: controllerId,
            ...fields,
        });
    }

    it("an opponent's basic land does not count (CR 109.5)", () => {
        expect(played([], [island("p2")]).isTapped).toBe(true);
    });

    it("counts a basic land you control but do not own", () => {
        const stolen = island("p1", { ownerId: "p2" });
        expect(played([stolen], []).isTapped).toBe(false);
    });

    it("a basic land that lost the supertype no longer counts (CR 205.4c, live read)", () => {
        const stripped = island("p1", {
            removedSupertypes: [{ supertype: "Basic", sourceId: "src" }],
        });
        expect(played([stripped], []).isTapped).toBe(true);
    });

    it("a land granted the supertype counts (CR 205.4c, live read)", () => {
        const granted = makeInstance(ABANDONED_AIR_TEMPLE, {
            controllerId: "p1",
            ownerId: "p1",
            grantedSupertypes: [{ supertype: "Basic", sourceId: "src" }],
        });
        expect(played([granted], []).isTapped).toBe(false);
    });

    it("a basic non-land does not satisfy the land half of the filter", () => {
        const notALand = island("p1", { types: ["Creature"] });
        expect(played([notALand], []).isTapped).toBe(true);
    });
});
