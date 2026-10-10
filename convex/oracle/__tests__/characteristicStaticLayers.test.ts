// Compiled characteristic-setting statics in the REAL layer system (CR 613,
// issue #4565): the grammar goldens prove what the compiler emits, this file
// proves the descriptors it emits move a creature's power and toughness — and
// survive `projectPublicState`, which is what the client reads.
//
// Skyshroud Elite has no hand-written twin, so its `opponent-controls`
// condition is exercised nowhere else.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";

function define(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return { ...outcome.definition, id: card.oracleId, rarity: "common" };
}

function card(over: Partial<OracleCard> & { oracleId: string }): OracleCard {
    return {
        name: over.oracleId,
        manaCost: "",
        typeLine: "Creature — Cat",
        oracleText: "",
        power: "2",
        toughness: "1",
        layout: "normal",
        ...over,
    };
}

const ELITE = define(
    card({
        oracleId: "elite-4565",
        name: "Skyshroud Elite",
        manaCost: "{G}",
        typeLine: "Creature — Elf Scout",
        power: "1",
        toughness: "1",
        oracleText:
            "This creature gets +1/+2 as long as an opponent controls a nonbasic land.",
    })
);
const FOREST = define(
    card({
        oracleId: "forest-4565",
        typeLine: "Basic Land — Forest",
        power: undefined,
        toughness: undefined,
    })
);
const NONBASIC = define(
    card({
        oracleId: "nonbasic-4565",
        typeLine: "Land",
        power: undefined,
        toughness: undefined,
    })
);

describe("Skyshroud Elite — opponent-controls condition (CR 611.3a)", () => {
    function power(opponentLand: CardDefinition | undefined, mine = false) {
        return withTemporaryDefinition(ELITE, () =>
            withTemporaryDefinition(FOREST, () =>
                withTemporaryDefinition(NONBASIC, () => {
                    const elite = makeInstance(ELITE.id, { id: "elite" });
                    const land =
                        opponentLand === undefined
                            ? []
                            : [
                                  makeInstance(opponentLand.id, {
                                      id: "land",
                                      controllerId: mine ? "p1" : "p2",
                                  }),
                              ];
                    const state = makeState({
                        players: [
                            makePlayer("p1", {
                                battlefield: [elite, ...(mine ? land : [])],
                            }),
                            makePlayer("p2", {
                                battlefield: mine ? [] : land,
                            }),
                        ],
                    });
                    const projected = projectPublicState(state, 1, "p1");
                    const slim = projected.players[0]!.battlefield.find(
                        (c) => c.id === "elite"
                    )!;
                    expect(getEffectiveToughness(projected, slim)).toBe(
                        getEffectiveToughness(state, elite)
                    );
                    return getEffectivePower(state, elite);
                })
            )
        );
    }

    it("buffs while an opponent controls a nonbasic land", () => {
        expect(power(NONBASIC)).toBe(2);
    });

    it("does not buff with no land, an opponent's basic land, or its own nonbasic land", () => {
        expect(power(undefined)).toBe(1);
        expect(power(FOREST)).toBe(1);
        expect(power(NONBASIC, true)).toBe(1);
    });
});

describe("Terravore — graveyard-count characteristic-defining P/T (CR 604.3)", () => {
    const TERRAVORE = define(
        card({
            oracleId: "terravore-4565",
            name: "Terravore",
            manaCost: "{1}{G}{G}",
            typeLine: "Creature — Lhurgoyf",
            power: "*",
            toughness: "*",
            oracleText:
                "Terravore's power and toughness are each equal to the number of land cards in all graveyards.",
        })
    );

    it("counts land cards in EVERY graveyard and nothing else", () => {
        withTemporaryDefinition(TERRAVORE, () =>
            withTemporaryDefinition(FOREST, () =>
                withTemporaryDefinition(NONBASIC, () => {
                    const terravore = makeInstance(TERRAVORE.id, {
                        id: "terravore",
                    });
                    const state = makeState({
                        players: [
                            makePlayer("p1", {
                                battlefield: [terravore],
                                graveyard: [
                                    makeInstance(FOREST.id, {
                                        zone: "graveyard",
                                    }),
                                    makeInstance(FOREST.id, {
                                        zone: "graveyard",
                                    }),
                                    makeInstance(TERRAVORE.id, {
                                        zone: "graveyard",
                                    }),
                                ],
                            }),
                            makePlayer("p2", {
                                graveyard: [
                                    makeInstance(NONBASIC.id, {
                                        zone: "graveyard",
                                        controllerId: "p2",
                                    }),
                                ],
                            }),
                        ],
                    });
                    expect(getEffectivePower(state, terravore)).toBe(3);
                    expect(getEffectiveToughness(state, terravore)).toBe(3);
                    const projected = projectPublicState(state, 1, "p1");
                    const slim = projected.players[0]!.battlefield[0]!;
                    expect(getEffectivePower(projected, slim)).toBe(3);
                })
            )
        );
    });
});

describe("Engineered Plague — the chosen creature type (CR 607.2d)", () => {
    const PLAGUE = define(
        card({
            oracleId: "plague-4565",
            name: "Engineered Plague",
            manaCost: "{2}{B}",
            typeLine: "Enchantment",
            power: undefined,
            toughness: undefined,
            oracleText:
                "As this enchantment enters, choose a creature type.\nAll creatures of the chosen type get -1/-1.",
        })
    );
    const CAT = define(card({ oracleId: "cat-4565" }));
    const BEAR = define(
        card({ oracleId: "bear-4565", typeLine: "Creature — Bear" })
    );

    it("shrinks only creatures of the type the source chose", () => {
        withTemporaryDefinition(PLAGUE, () =>
            withTemporaryDefinition(CAT, () =>
                withTemporaryDefinition(BEAR, () => {
                    const plague = makeInstance(PLAGUE.id, {
                        id: "plague",
                        chosenSubtypes: ["Cat"],
                    });
                    const cat = makeInstance(CAT.id, { id: "cat" });
                    const bear = makeInstance(BEAR.id, { id: "bear" });
                    const state = makeState({
                        players: [
                            makePlayer("p1", { battlefield: [plague, cat] }),
                            makePlayer("p2", { battlefield: [bear] }),
                        ],
                    });
                    expect(getEffectivePower(state, cat)).toBe(1);
                    expect(getEffectiveToughness(state, cat)).toBe(0);
                    expect(getEffectivePower(state, bear)).toBe(2);
                    // No choice made yet: fail closed, nobody shrinks.
                    const unchosen = makeInstance(PLAGUE.id, { id: "p0" });
                    const idle = makeState({
                        players: [
                            makePlayer("p1", { battlefield: [unchosen, cat] }),
                            makePlayer("p2"),
                        ],
                    });
                    expect(getEffectivePower(idle, cat)).toBe(2);
                })
            )
        );
    });
});
