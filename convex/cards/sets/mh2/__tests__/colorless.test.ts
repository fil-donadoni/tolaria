// Per-card behavior tests for colorless cards in `convex/cards/sets/mh2/colorless.ts`
// (Modern Horizons 2, split by colour per ADR 0043). Yavimaya, Cradle of
// Growth is the "Forest" mirror of Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — same `subtype-add` static-effect
// shape (CR 305.7, 611). Urborg's test file carries the exhaustive coverage
// (apply/existing-grants/unapply/wire-format); this file only re-confirms the
// additive behavior and the self-mana-ability inference for Yavimaya, per the
// project's per-Op / lighter-mirror testing convention.

import { describe, it, expect } from "vitest";
import { yavimayaCradleOfGrowth } from "..";
import { swamp } from "../../lea";
import { makeInstance, makeState } from "../../../__tests__/setup";
import { getBasicLandMana } from "../../../../gre/constants";
import { applySourceStaticEffects } from "../../../../gre/state";

describe("Yavimaya, Cradle of Growth ({T}: Add {G} via basic-land inference — CR 305.7, 611)", () => {
    it("declares exactly one subtype-add static effect matching every land", () => {
        const kinds = (yavimayaCradleOfGrowth.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toEqual(["subtype-add"]);
    });

    it("adds Forest additively to another land already on the battlefield (original subtype NOT replaced)", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const otherSwamp = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);
        state.players[1].battlefield.push(otherSwamp);

        applySourceStaticEffects(state, yavimaya);

        expect(otherSwamp.subtypes).toContain("Swamp");
        expect(otherSwamp.subtypes).toContain("Forest");
        expect(otherSwamp.subtypes).toHaveLength(2);
    });

    it("Yavimaya itself can tap for {G} via the free basic-land-type inference", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);

        applySourceStaticEffects(state, yavimaya);

        expect(yavimaya.subtypes).toContain("Forest");
        expect(getBasicLandMana(yavimaya)).toBe("G");
    });
});
