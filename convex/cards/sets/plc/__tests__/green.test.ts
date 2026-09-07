// Per-card behavior tests for green cards in `convex/cards/sets/plc/green.ts`
// (Planar Chaos, split by colour per ADR 0043).
//
// Life and Limb is one Oracle line spread across three CR 613 layers — layer 4
// (types and subtypes), layer 5 (colour) and sublayer 7b (base P/T, the
// `pt-set` kind issue #3161 added). The Saproling case is what makes 7b the
// only correct home for the P/T clause: a token is ALREADY 1/1, so a 7a
// contribution or a 7c buff of 1/1 would read 2/2 on it.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, tokenDefinitionId } from "../../../index";
import { getEffectiveColors } from "../../../effectiveColors";
import {
    type CardInstanceState,
    type GameState,
    beginApplyingStaticEffects,
} from "../../../../gre/state";
import {
    type LayerStateView,
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

const lifeAndLimb = getDefinition("0efe9e8e-7fb3-4a6d-be3d-7965d2ffb0a3");

const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");

/** The 1/1 green Saproling token every Saproling-maker in the catalogue
 *  creates (Saproling Burst, Sprout, …) — a token definition, so it has no
 *  printed card and its id IS its content. */
const SAPROLING_ID = tokenDefinitionId({
    name: "Saproling",
    types: ["Creature"],
    subtypes: ["Saproling"],
    power: 1,
    toughness: 1,
    colors: ["G"],
});

/** Life and Limb on p1's battlefield beside `others` on p2's, statics applied. */
function withLifeAndLimb(others: CardInstanceState[]): GameState {
    const enchantment = makeInstance(lifeAndLimb.id, {
        id: "lal-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [enchantment] }),
            makePlayer("p2", { battlefield: others }),
        ],
    });
    beginApplyingStaticEffects(state, enchantment);
    return state;
}

function forestOnBoard(id = "forest-1"): CardInstanceState {
    return makeInstance(forest.id, {
        id,
        controllerId: "p2",
        zone: "battlefield",
    });
}

function saprolingOnBoard(id = "sap-1"): CardInstanceState {
    return makeInstance(SAPROLING_ID, {
        id,
        controllerId: "p2",
        zone: "battlefield",
    });
}

describe("Life and Limb ({3}{G} Enchantment — CR 613 layers 4, 5 and sublayer 7b)", () => {
    it("makes a Forest a 1/1 creature, keeping its land types (CR 613.4b, 305.7)", () => {
        const woods = forestOnBoard();
        const state = withLifeAndLimb([woods]);

        expect(woods.types).toContain("Creature");
        expect(woods.types).toContain("Land");
        expect(woods.subtypes).toContain("Forest");
        expect(woods.subtypes).toContain("Saproling");
        expect(getEffectivePower(state, woods)).toBe(1);
        expect(getEffectiveToughness(state, woods)).toBe(1);
    });

    it("leaves a Saproling token at 1/1, not 2/2 (CR 613.4b SETS, it does not add)", () => {
        // The assertion the whole `pt-set` kind exists for: a 7a `pt-cda` or a
        // 7c `pt-buff` contributing 1/1 would read 2/2 here.
        const sap = saprolingOnBoard();
        const state = withLifeAndLimb([sap]);

        expect(getEffectivePower(state, sap)).toBe(1);
        expect(getEffectiveToughness(state, sap)).toBe(1);
        // …and it gains the OTHER half: a Saproling becomes a Forest land.
        expect(sap.types).toContain("Land");
        expect(sap.subtypes).toContain("Forest");
    });

    it("adds green (CR 613.1e layer 5) — additively, per the marked divergence", () => {
        const woods = forestOnBoard();
        withLifeAndLimb([woods]);

        expect(getEffectiveColors(woods as never)).toContain("G");
    });

    it("leaves a land that is neither a Forest nor a Saproling alone", () => {
        const isle = makeInstance(island.id, {
            id: "island-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const state = withLifeAndLimb([isle]);

        expect(isle.types).not.toContain("Creature");
        expect(isle.subtypes).not.toContain("Saproling");
        expect(getEffectivePower(state, isle)).toBe(0);
    });

    it("stops applying when it leaves the battlefield (CR 611.2)", () => {
        // The FOREST, not the token: a Saproling prints 1/1, so asserting 1/1
        // on it after the source leaves passes with the whole `pt-set` kind
        // deleted. A Forest prints no P/T at all, so the read has to move.
        const woods = forestOnBoard();
        const state = withLifeAndLimb([woods]);
        expect(getEffectivePower(state, woods)).toBe(1);

        state.players[0].battlefield = [];

        // The 7b entry is derived from the live source, so it is gone at the
        // next read — no purge pass in between. The layer-4 animation is
        // MATERIALISED, so it is unapplied on the way out instead.
        expect(getEffectivePower(state, woods)).toBe(0);
        expect(getEffectiveToughness(state, woods)).toBe(0);
    });

    // Wire format (MANDATORY for staticEffects, per gre-development.md § Card
    // testing convention): the client re-derives layer 7 from the projected
    // board, so a 7b set that does not survive the projection renders as the
    // printed P/T while the server counts 1/1.
    it("wire format: the 1/1 Forest creature survives projectPublicState", () => {
        const woods = forestOnBoard();
        const state = withLifeAndLimb([woods]);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "forest-1"
        )!;
        const wireState = projected as unknown as LayerStateView;

        expect(slim.types).toContain("Creature");
        expect(slim.subtypes).toContain("Saproling");
        expect(getEffectivePower(wireState, slim as CardInstanceState)).toBe(1);
        expect(
            getEffectiveToughness(wireState, slim as CardInstanceState)
        ).toBe(1);
        expect(getEffectiveColors(slim as never)).toContain("G");
    });
});
