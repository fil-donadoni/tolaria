// kld (Kaladesh) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { inspiringVantage } from "../colorless";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer } from "../../../../gre/state";

// The KLD "fast land" cycle — see SOM's Copperline Gorge test
// (`convex/cards/sets/som/__tests__/colorless.test.ts`) for the full
// `entersTappedUnless` (CR 614.1c) behavior test; this file re-proves it once
// on Inspiring Vantage and snapshot-checks the rest of the cycle's colours
// (all five share the identical `makeDualLand({ fastLand: true })` factory).
describe("Inspiring Vantage (fast land, CR 614.1c / 605.1a)", () => {
    it("enters UNTAPPED with two or fewer other lands", () => {
        const otherLands = [makeInstance(island.id, { id: "l1" })];
        const vantage = makeInstance(inspiringVantage.id, {
            id: "vantage",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [vantage] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "vantage")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED with three or more other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
            makeInstance(island.id, { id: "l3" }),
        ];
        const vantage = makeInstance(inspiringVantage.id, {
            id: "vantage",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [vantage] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "vantage")!;
        expect(played.isTapped).toBe(true);
    });
});
