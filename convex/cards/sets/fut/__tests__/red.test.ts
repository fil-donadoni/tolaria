// FUT — red behaviour tests (ADR 0043 colour split). Magus of the Moon reprints
// Blood Moon's static ability on a creature body: CR 305.7 layer-4 subtype
// replacement preceded by the CR 613.1f layer-6 ability strip, both scanning
// the shared `IS_NONBASIC_LAND` predicate (`convex/cards/types.ts`).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    abilitiesSuppressed,
    getActivatedManaAbility,
    getBasicLandMana,
    hasManaAbility,
} from "../../../../gre/constants";
import { getProducibleManaOptions } from "../../../../gre/rules";
import {
    beginApplyingStaticEffects,
    stopApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const magusOfTheMoon = getDefinition("c06a4443-6851-4873-8fb8-2ef76c9d6d2c");
const tropicalIsland = getDefinition("a9c6c759-aabf-44e7-ba8c-33c5df232b56");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");
const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");

/** Magus of the Moon on p1's battlefield plus one of p2's lands, statics
 *  applied. */
function withMagus(landCardId: string = tropicalIsland.id): {
    state: GameState;
    magus: CardInstanceState;
    land: CardInstanceState;
} {
    const magus = makeInstance(magusOfTheMoon.id, {
        id: "magus-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const land = makeInstance(landCardId, {
        id: "land-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [magus] }),
            makePlayer("p2", { battlefield: [land] }),
        ],
    });
    beginApplyingStaticEffects(state, magus);
    return { state, magus, land };
}

describe("Magus of the Moon ({2}{R} 2/2 — CR 305.7 subtype-set + CR 613.1f ability-loss)", () => {
    it("turns a nonbasic dual land into a Mountain — CR 305.7", () => {
        const { land } = withMagus();
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(land.subtypes).not.toContain("Forest");
        expect(land.subtypes).not.toContain("Island");
    });

    it("strips the dual land's printed mana ability, leaving the intrinsic one — CR 613.1f", () => {
        const { land } = withMagus();
        expect(abilitiesSuppressed(land)).toBe(true);
        expect(getActivatedManaAbility(land)).toBeNull();
        expect(hasManaAbility(land)).toBe(true);
        expect(getBasicLandMana(land)).toBe("R");
        expect([...getProducibleManaOptions(land).keys()]).toEqual(["R"]);
    });

    it("leaves BASIC lands untouched — a basic Island stays an Island", () => {
        const { land } = withMagus(island.id);
        expect(land.subtypes).toEqual(["Island"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(getBasicLandMana(land)).toBe("U");
    });

    it("leaves a basic Mountain untouched (no suppression, still {R})", () => {
        const { land } = withMagus(mountain.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("reverts cleanly when the Magus leaves the battlefield", () => {
        const { state, magus, land } = withMagus();
        expect(land.subtypes).toEqual(["Mountain"]);
        stopApplyingStaticEffects(state, magus);
        expect(land.subtypes).toEqual(["Forest", "Island"]);
        expect(abilitiesSuppressed(land)).toBe(false);
    });

    it("survives the wire projection — the client sees the Mountain too", () => {
        const { state } = withMagus();
        const projected = projectPublicState(state, 1, "p1");
        const slimLand = projected.players[1].battlefield.find(
            (c) => c.id === "land-1"
        )!;
        expect(slimLand.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(slimLand)).toBe("R");
    });
});
