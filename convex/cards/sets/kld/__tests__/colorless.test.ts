// kld (Kaladesh) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    inspiringVantage,
    spirebluffCanal,
    botanicalSanctum,
    bloomingMarsh,
    concealedCourtyard,
} from "../colorless";
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
        const played = applyPlayLand(state, player, "vantage");
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
        const played = applyPlayLand(state, player, "vantage");
        expect(played.isTapped).toBe(true);
    });
});

describe.each([
    { def: inspiringVantage, colors: [{ R: 1 }, { W: 1 }] },
    { def: spirebluffCanal, colors: [{ U: 1 }, { R: 1 }] },
    { def: botanicalSanctum, colors: [{ G: 1 }, { U: 1 }] },
    { def: bloomingMarsh, colors: [{ B: 1 }, { G: 1 }] },
    { def: concealedCourtyard, colors: [{ W: 1 }, { B: 1 }] },
])("$def.name (fast land mana choices)", ({ def, colors }) => {
    it("declares an entersTappedUnless predicate and the correct two-colour choice", () => {
        expect(typeof def.entersTappedUnless).toBe("function");
        const ability = def.activatedAbilities![0];
        expect(ability.manaChoices).toEqual(colors);
    });
});
