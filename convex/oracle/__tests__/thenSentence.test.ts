// Two Grammar Rules a Spacecraft's enters trigger needs (issue #10554):
//
//  1. CR 205.3g — "this Spacecraft" names the source, like "this Vehicle":
//     Spacecraft is an artifact type, and a station card's lines call it that
//     whether or not it is a creature yet (`SELF_NOUNS`, `targetFilter.ts`).
//  2. CR 608.2c — a sentence-initial "Then" adds nothing a full stop does not
//     already say: the sentence after it is read by the same grammar
//     (`readThenSentence`, `effectClause.ts`). Only a plain EFFECT is
//     accepted; a "Then" in front of a sentence `assembleSentences` binds to
//     its neighbour (a modifier, a fold marker) is refused.
//
// No golden fixture (`grammar/fixtures.ts`): a fixture must clear a
// card-dependent smoke form, and neither rule emits one — the definitions are
// asserted whole here instead.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const STATION_5 =
    "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 5+.)";

const BATTLESHIP_TRIGGER =
    "When this Spacecraft enters, destroy target noncreature permanent. Then this Spacecraft deals 4 damage to each creature.";

const EXTINGUISHER_BATTLESHIP = oracleCard({
    oracleId: "cce3dcc3-57bb-4b95-8b70-337c67bb3c4e",
    name: "Extinguisher Battleship",
    manaCost: "{8}",
    typeLine: "Artifact — Spacecraft",
    oracleText: [BATTLESHIP_TRIGGER, STATION_5, "5+ | Flying, trample"].join(
        "\n"
    ),
    power: "10",
    toughness: "10",
});

const SUUROK = oracleCard({
    oracleId: "5d2016ed-3ea0-4938-b95e-ee582307e475",
    name: "Suurok-Class Science Vessel",
    manaCost: "{2}{U}",
    typeLine: "Artifact — Spacecraft",
    oracleText: [
        "When this Spacecraft enters, draw a card.",
        STATION_5,
        "5+ | Flying",
    ].join("\n"),
    power: "3",
    toughness: "2",
});

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Test Sorcery",
        manaCost: "{2}{B}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("this Spacecraft names the source (CR 205.3g)", () => {
    it("Suurok-Class Science Vessel: the enters head is the source's own", () => {
        const outcome = compileCard(SUUROK);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.compiledTriggeredAbilities).toEqual([
            {
                id: "suurok-class-science-vessel-trigger",
                oracleText: "When this Spacecraft enters, draw a card.",
                head: { kind: "entered", scope: "self" },
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });
});

describe('a sentence-initial "Then" (CR 608.2c)', () => {
    it("GOLDEN — Extinguisher Battleship: destroy, then 4 to each creature, in order", () => {
        const outcome = compileCard(EXTINGUISHER_BATTLESHIP);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Extinguisher Battleship",
                manaCost: { X: 8 },
                types: ["Artifact"],
                subtypes: ["Spacecraft"],
                oracleText: EXTINGUISHER_BATTLESHIP.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "extinguisher-battleship-trigger",
                        oracleText: BATTLESHIP_TRIGGER,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                            excludeTypes: ["Creature"],
                        },
                        effects: [
                            { op: "destroy", target: { target: 0 } },
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    filter: { type: "Creature" },
                                },
                                effects: [
                                    {
                                        op: "dealDamage",
                                        amount: 4,
                                        to: { ref: "$each" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
                stationThresholds: [
                    {
                        charge: 5,
                        creature: { power: 10, toughness: 10 },
                        keywords: ["flying", "trample"],
                    },
                ],
            })
        );
    });

    it('reads the same effects as the sentence printed without "Then"', () => {
        const withThen = compileCard(
            sorcery("Draw a card. Then each opponent loses 2 life.")
        );
        const without = compileCard(
            sorcery("Draw a card. Each opponent loses 2 life.")
        );
        expect(without.state).toBe("ready");
        expect(withThen.state).toBe("ready");
        if (withThen.state !== "ready" || without.state !== "ready") return;
        expect(withThen.definition.effects).toEqual(without.definition.effects);
    });

    it('REFUSES a "Then" in front of a modifier: it binds to its neighbour, not an effect', () => {
        expect(
            compileCard(
                sorcery("Destroy target creature. It can't be regenerated.")
            ).state
        ).toBe("ready");
        expect(
            compileCard(
                sorcery(
                    "Destroy target creature. Then it can't be regenerated."
                )
            ).state
        ).toBe("unparsed");
    });
});
