// kld (Kaladesh) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    inspiringVantage,
    bloomingMarsh,
    botanicalSanctum,
    concealedCourtyard,
    spirebluffCanal,
} from "../colorless";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer } from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

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

// The other four cycle members share the identical `makeDualLand({ fastLand:
// true })` shape but each own a DISTINCT `manaChoices` colour pair — the mana
// sweep (`manaAbility.catalogue.test.ts`) explicitly skips `manaChoices`
// abilities, so the CHOICE INDEX → colour mapping is untested catalogue-wide
// and must be proven per card (see Talisman cycle,
// `convex/cards/sets/mrd/__tests__/colorless.test.ts`, for the pattern).
describe.each([
    { def: spirebluffCanal, colors: ["U", "R"] as const },
    { def: botanicalSanctum, colors: ["G", "U"] as const },
    { def: bloomingMarsh, colors: ["B", "G"] as const },
    { def: concealedCourtyard, colors: ["W", "B"] as const },
])("$def.name (fast land, CR 614.1c / 605.1a)", ({ def, colors: [c1, c2] }) => {
    it("enters UNTAPPED with two or fewer other lands", () => {
        const otherLands = [makeInstance(island.id, { id: "l1" })];
        const land = makeInstance(def.id, { id: "land", zone: "hand" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [land] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "land")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED with three or more other lands, and the tapped state survives the wire projection", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
            makeInstance(island.id, { id: "l3" }),
        ];
        const land = makeInstance(def.id, { id: "land", zone: "hand" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [land] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "land")!;
        expect(played.isTapped).toBe(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "land"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    it(`choice index 0 taps for {${c1}}, index 1 taps for {${c2}} (manaChoices, CR 605.1a)`, () => {
        const land = makeInstance(def.id, { id: "land", isTapped: false });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        tapSourceIntoPayment(state, player, land, 0, []);
        expect(player.manaPool[c1]).toBe(1);
        expect(player.manaPool[c2]).toBe(0);
        expect(land.isTapped).toBe(true);
    });

    it(`choice index 1 taps for {${c2}} instead`, () => {
        const land = makeInstance(def.id, { id: "land", isTapped: false });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        tapSourceIntoPayment(state, player, land, 1, []);
        expect(player.manaPool[c2]).toBe(1);
        expect(player.manaPool[c1]).toBe(0);
    });
});
