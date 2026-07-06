// Scars of Mirrodin (SOM) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { copperlineGorge } from "../colorless";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer } from "../../../../gre/state";

// The SOM "fast land" cycle — "This land enters tapped unless you control
// two or fewer other lands." (CR 614.1c self-conditional replacement via the
// NEW `entersTappedUnless` field, issue #675.)
describe("Copperline Gorge (fast land, CR 614.1c / 605.1a)", () => {
    it("enters UNTAPPED with two or fewer other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED with three or more other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
            makeInstance(island.id, { id: "l3" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(true);
    });

    it("taps for R or G", () => {
        const ability = copperlineGorge.activatedAbilities![0];
        expect(ability.manaChoices).toEqual([{ R: 1 }, { G: 1 }]);
    });
});
