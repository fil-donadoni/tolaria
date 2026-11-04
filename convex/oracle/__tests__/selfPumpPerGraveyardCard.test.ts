// "This creature gets +N/+N for each creature card in your graveyard" (CR 613.4c,
// CR 404.1, CR 109.5).
//
// The golden proves what the compiler emits; the layer tests prove the
// descriptor moves a creature's power and toughness in the REAL layer system,
// and survives `projectPublicState`, which is what the client reads.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const PUMP_LINE =
    "This creature gets +1/+1 for each creature card in your graveyard.";

const LILIANAS_ELITE = oracleCard({
    oracleId: "b6492082-d0ef-4f7c-a4b1-f8ecf6eb0890",
    name: "Liliana's Elite",
    manaCost: "{2}{B}",
    typeLine: "Creature — Zombie",
    oracleText: PUMP_LINE,
    power: "1",
    toughness: "1",
});

function creature(oracleText: string) {
    return oracleCard({
        name: "Probe",
        manaCost: "{1}",
        typeLine: "Creature — Zombie",
        oracleText,
        power: "1",
        toughness: "1",
    });
}

function compiled(card: ReturnType<typeof oracleCard>): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} is ${outcome.state}`);
    return { ...outcome.definition, id: card.oracleId, rarity: "common" };
}

describe("self pump per graveyard card — golden (CR 613.4c)", () => {
    it("Liliana's Elite: the buff is per creature card in your graveyard", () => {
        const outcome = compileCard(LILIANAS_ELITE);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Liliana's Elite",
                types: ["Creature"],
                subtypes: ["Zombie"],
                manaCost: { X: 2, B: 1 },
                power: 1,
                toughness: 1,
                oracleText: PUMP_LINE,
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "self",
                        power: 1,
                        toughness: 1,
                        count: {
                            kind: "controller-graveyard-cards",
                            types: ["Creature"],
                        },
                    },
                ],
            })
        );
    });
});

describe("self pump per graveyard card — refused neighbours (fail-closed)", () => {
    it.each([
        [
            "another card type",
            "This creature gets +1/+1 for each land card in your graveyard.",
        ],
        [
            "another graveyard",
            "This creature gets +1/+1 for each creature card in your opponents' graveyards.",
        ],
        [
            "a second count joined to the first",
            "This creature gets +1/+1 for each creature you control and each creature card in your graveyard.",
        ],
        [
            "a debuff",
            "This creature gets -1/-1 for each creature card in your graveyard.",
        ],
        [
            "a subject other than this creature",
            "Enchanted creature gets +1/+1 for each creature card in your graveyard.",
        ],
    ])("%s stays unparsed", (_form, text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });
});

describe("self pump per graveyard card — the layer system (CR 613.4c)", () => {
    const ELITE = compiled(LILIANAS_ELITE);
    const CREATURE_CARD: CardDefinition = compiled(
        oracleCard({
            oracleId: "graveyard-creature",
            name: "Graveyard Creature",
            manaCost: "{1}",
            typeLine: "Creature — Zombie",
            oracleText: "",
            power: "2",
            toughness: "2",
        })
    );
    const LAND_CARD: CardDefinition = compiled(
        oracleCard({
            oracleId: "graveyard-land",
            name: "Graveyard Land",
            manaCost: "",
            typeLine: "Land",
            oracleText: "",
        })
    );

    function withCards(run: () => void): void {
        withTemporaryDefinition(ELITE, () =>
            withTemporaryDefinition(CREATURE_CARD, () =>
                withTemporaryDefinition(LAND_CARD, run)
            )
        );
    }

    const inGraveyard = (definition: CardDefinition, ownerId: string) =>
        makeInstance(definition.id, {
            zone: "graveyard",
            ownerId,
            controllerId: ownerId,
        });

    it("counts creature cards in your graveyard, not lands or the opponent's", () => {
        withCards(() => {
            const elite = makeInstance(ELITE.id, { id: "elite" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [elite],
                        graveyard: [
                            inGraveyard(CREATURE_CARD, "p1"),
                            inGraveyard(CREATURE_CARD, "p1"),
                            inGraveyard(LAND_CARD, "p1"),
                        ],
                    }),
                    makePlayer("p2", {
                        graveyard: [
                            inGraveyard(CREATURE_CARD, "p2"),
                            inGraveyard(CREATURE_CARD, "p2"),
                            inGraveyard(CREATURE_CARD, "p2"),
                        ],
                    }),
                ],
            });
            expect(getEffectivePower(state, elite)).toBe(3);
            expect(getEffectiveToughness(state, elite)).toBe(3);

            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]!.battlefield[0]!;
            expect(getEffectivePower(projected, slim)).toBe(3);
            expect(getEffectiveToughness(projected, slim)).toBe(3);
        });
    });

    it("is its printed P/T over an empty graveyard", () => {
        withCards(() => {
            const elite = makeInstance(ELITE.id, { id: "elite" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [elite] }),
                    makePlayer("p2"),
                ],
            });
            expect(getEffectivePower(state, elite)).toBe(1);
            expect(getEffectiveToughness(state, elite)).toBe(1);
        });
    });

    it('"your" is the current controller, not the owner (CR 109.5)', () => {
        withCards(() => {
            const stolen = makeInstance(ELITE.id, {
                id: "elite",
                ownerId: "p2",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [stolen],
                        graveyard: [inGraveyard(CREATURE_CARD, "p1")],
                    }),
                    makePlayer("p2", {
                        graveyard: [
                            inGraveyard(CREATURE_CARD, "p2"),
                            inGraveyard(CREATURE_CARD, "p2"),
                            inGraveyard(CREATURE_CARD, "p2"),
                        ],
                    }),
                ],
            });
            expect(getEffectivePower(state, stolen)).toBe(2);
            expect(getEffectiveToughness(state, stolen)).toBe(2);
        });
    });
});
