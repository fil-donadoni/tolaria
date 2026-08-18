// CR 113.6c — "An ability that states which zones it doesn't function in
// functions everywhere except for the specified zones." Grist, the Hunger Tide
// ("As long as Grist isn't on the battlefield, it's a 1/1 Insect creature")
// declares it, and `gre/zoneCharacteristics.ts` materialises it onto the
// instance so every reader of `types` / `power` sees it without knowing the
// module exists.
//
// WHAT THIS FILE GUARDS, and why it isn't in the Grist card test: the OFF
// direction (a card landing in a hidden zone gains the characteristics) is
// covered card-side, but the ON direction — a permanent ENTERING the
// battlefield having them stripped — has to hold at EVERY battlefield-entry
// path, and the two paths the Grist test can reach (a resolving permanent
// spell, a put-onto-battlefield effect) are not the only ones. The general
// zone-mover `moveCard` and the cross-player `moveCardAcrossPlayers` also take
// cards to the battlefield, via the four land-play paths, and no shipped card
// is BOTH a land and zone-conditional — so the only way to prove those two
// paths clear is a synthetic land that declares the ability. The header of
// `clearZoneCharacteristics` enumerates the entry sites as a closed list;
// these tests are what stops that list from being a claim nobody checked.
//
// The synthetic definitions also exercise a second property: they are
// registered through `preloadDefinitions` AFTER module load, so a green run
// proves the registry-side `declaresOffBattlefieldCharacteristics` index
// (`cards/registry.ts`) — the precheck that keeps the state-based-action sweep
// cheap — is maintained by the registry's write funnel rather than snapshotted
// once at import time.

import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../cards/__tests__/setup";
import { applyPlayLand, applyPlayLandFromExile } from "../playLand";
import { checkStateBasedActions } from "../sba";

// A land that is a 1/1 Insect creature everywhere except the battlefield —
// Grist's shape transplanted onto a card type that reaches the battlefield
// through `moveCard` instead of through spell resolution.
const ZONE_LAND_ID = "00000000-0000-4000-8000-00002391f001";

preloadDefinitions([
    {
        id: ZONE_LAND_ID,
        name: "Synthetic Zone-Conditional Land",
        rarity: "rare",
        manaCost: {},
        types: ["Land"],
        offBattlefieldCharacteristics: {
            addTypes: ["Creature"],
            addSubtypes: ["Insect"],
            power: 1,
            toughness: 1,
        },
    } as CardDefinition,
]);

describe("off-battlefield characteristics on battlefield entry (CR 113.6c)", () => {
    it("strips them when a land is played from hand (moveCard)", () => {
        const land = makeInstance(ZONE_LAND_ID, { zone: "hand" });
        const p1 = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // In hand the ability functions: the SBA sweep materialises the
        // off-battlefield characteristics and the card IS a 1/1 Insect
        // creature. (Also the precheck's own proof — a definition registered
        // after module load still gets swept.)
        checkStateBasedActions(state);
        expect(land.types).toContain("Creature");
        expect(land.subtypes).toContain("Insect");
        expect(land.power).toBe(1);

        const entered = applyPlayLand(state, state.players[0], land.id);

        expect(entered).not.toBeNull();
        expect(entered!.zone).toBe("battlefield");
        // On the battlefield the ability switches off — printed land, no P/T.
        expect(entered!.types).toEqual(["Land"]);
        expect(entered!.subtypes ?? []).not.toContain("Insect");
        expect(entered!.power).toBeUndefined();
        expect(entered!.toughness).toBeUndefined();
    });

    it("strips them when a land is played from an OPPONENT's exile (moveCardAcrossPlayers)", () => {
        // issue #1156 — a cross-player play grant (Dauthi Voidwalker) takes a
        // card out of the OPPONENT's exile straight onto the caster's
        // battlefield, the one entry path `moveCard` cannot serve.
        const land = makeInstance(ZONE_LAND_ID, {
            zone: "exile",
            ownerId: "p2",
            controllerId: "p2",
            castableFromExileBy: "p1",
            castableFromExileIncludesLand: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { exile: [land] });
        const state = makeState({ players: [p1, p2] });

        checkStateBasedActions(state);
        expect(land.types).toContain("Creature");

        const entered = applyPlayLandFromExile(
            state,
            state.players[0],
            land.id
        );

        expect(entered).not.toBeNull();
        expect(entered!.zone).toBe("battlefield");
        expect(state.players[0].battlefield).toContain(entered);
        expect(entered!.types).toEqual(["Land"]);
        expect(entered!.power).toBeUndefined();
        expect(entered!.toughness).toBeUndefined();
    });
});
