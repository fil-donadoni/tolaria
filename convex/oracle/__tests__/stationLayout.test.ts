// Station cards in the compiler (CR 702.184 / 721, issue #10528): a station
// symbol is a STRIATION, not a line, and the station keyword line is
// structural (`grammar/stationSections.ts`).
//
//  1. GOLDEN — Lumen-Class Frigate's and Galvanizing Sawship's real Oracle rows,
//     the whole definition: the P/T box moves onto the striation the reminder
//     names (CR 721.2b), off the card (CR 721.2c).
//  2. REFUSALS — a card is refused whole, never truncated; a d20 table that
//     spells its results `N+ |` is never read as a station card.
//  3. THE ENGINE — a compiled station card driven through the real layer
//     system and activation gates, below and at each symbol.
//
// No golden fixture (`grammar/fixtures.ts`): a fixture must clear a
// card-dependent smoke form, and a station striation emits none — the Class
// layout (`classLayout.test.ts`) is tested the same way for the same reason.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { CHARGE_COUNTER } from "../../cards/abilities/station";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { isCreature } from "../../gre/constants";
import { activationPreconditionViolation } from "../../gre/activationPrecondition";
import { getEffectiveActivatedAbilities } from "../../gre/activatedAbilities";
import { compileCard } from "../compile";
import { readStationSections } from "../grammar/stationSections";
import { syncLayers2to5 } from "../../gre/layers2to5";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";
import { BEAR_ID } from "../../cards/__tests__/station.helper";

const KEYWORD_12 =
    "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)";
const BARE_KEYWORD = "Station";

const LUMEN = oracleCard({
    oracleId: "3aa0cda4-fb2d-4fd4-84f6-482089a85547",
    name: "Lumen-Class Frigate",
    manaCost: "{1}{W}",
    typeLine: "Artifact — Spacecraft",
    oracleText: [
        KEYWORD_12,
        "2+ | Other creatures you control get +1/+1.",
        "12+ | Flying, lifelink",
    ].join("\n"),
    power: "3",
    toughness: "5",
});

const EVENDO = oracleCard({
    oracleId: "83161d59-2520-4741-9328-e2a4a8b5d5bc",
    name: "Evendo, Waking Haven",
    manaCost: "",
    typeLine: "Land — Planet",
    oracleText: [
        "This land enters tapped.",
        "{T}: Add {G}.",
        "Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)",
        "12+ | {G}, {T}: Add {G} for each creature you control.",
    ].join("\n"),
    power: undefined,
    toughness: undefined,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome;
}

describe("station cards in the compiler (CR 721)", () => {
    it("GOLDEN — Lumen-Class Frigate: striations, the P/T box on 12+, no card P/T", () => {
        const outcome = compiled(LUMEN);
        expect(outcome.state).toBe("ready");
        expect(outcome.slots).toContain("station-symbol");
        expect(outcome.opsUsed).toContain("counters");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Lumen-Class Frigate",
                manaCost: { X: 1, W: 1 },
                types: ["Artifact"],
                subtypes: ["Spacecraft"],
                oracleText: LUMEN.oracleText,
                stationThresholds: [
                    {
                        charge: 2,
                        compiledStaticEffects: [
                            {
                                kind: "pt-buff",
                                filter: {
                                    types: ["Creature"],
                                    controllerRelation: "you",
                                    excludeSource: true,
                                },
                                power: 1,
                                toughness: 1,
                            },
                        ],
                    },
                    {
                        charge: 12,
                        creature: { power: 3, toughness: 5 },
                        keywords: ["flying", "lifelink"],
                    },
                ],
            })
        );
    });

    it("a bare keyword with ONE symbol puts the box on that symbol (CR 721.2b)", () => {
        const outcome = compiled(
            oracleCard({
                name: "Test Bare Ship",
                manaCost: "{3}",
                typeLine: "Artifact — Spacecraft",
                oracleText: [BARE_KEYWORD, "4+ | Flying"].join("\n"),
                power: "4",
                toughness: "4",
            })
        );
        expect(outcome.definition.stationThresholds).toEqual([
            {
                charge: 4,
                creature: { power: 4, toughness: 4 },
                keywords: ["flying"],
            },
        ]);
        expect(outcome.definition.power).toBeUndefined();
    });

    it("REFUSES a box, several symbols and a bare keyword: the box's striation is unknown", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Ambiguous Ship",
                manaCost: "{3}",
                typeLine: "Artifact — Spacecraft",
                oracleText: [
                    BARE_KEYWORD,
                    "2+ | Vigilance",
                    "6+ | Flying",
                ].join("\n"),
                power: "4",
                toughness: "4",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("REFUSES a reminder naming a symbol the card does not print", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Misprinted Ship",
                manaCost: "{3}",
                typeLine: "Artifact — Spacecraft",
                oracleText: [KEYWORD_12, "8+ | Flying"].join("\n"),
                power: "4",
                toughness: "4",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a d20 table spelled `N+ |` is not a station card (CR 706.3a)", () => {
        expect(
            readStationSections(
                [
                    "Roll a d20.",
                    "1—14 | Draw a card.",
                    "15+ | Draw two cards.",
                ].join("\n")
            )
        ).toBe(null);
    });
});

describe("a compiled station card in the engine (CR 721.2)", () => {
    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        fn: (def: CardDefinition) => T
    ): T {
        const def = {
            ...compiled(card).definition,
            id: card.oracleId,
            rarity: "rare",
        } as CardDefinition;
        return withTemporaryDefinition(def, () => fn(def));
    }

    function board(cardId: string, charge: number) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(cardId, {
                            id: "station",
                            controllerId: "p1",
                            ownerId: "p1",
                            staticSeq: 1,
                            counters: { [CHARGE_COUNTER]: charge },
                        }),
                        makeInstance(BEAR_ID, {
                            id: "bear",
                            controllerId: "p1",
                            ownerId: "p1",
                            staticSeq: 2,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("Lumen-Class Frigate: the 2+ anthem and the 12+ creature, each only at its symbol", () => {
        withCompiled(LUMEN, (def) => {
            const at1 = board(def.id, 1);
            const bear1 = at1.players[0].battlefield[1];
            expect(getEffectivePower(at1, bear1)).toBe(2);
            const at2 = board(def.id, 2);
            expect(getEffectivePower(at2, at2.players[0].battlefield[1])).toBe(
                3
            );
            syncLayers2to5(at2);
            expect(isCreature(at2.players[0].battlefield[0])).toBe(false);
            const at12 = board(def.id, 12);
            syncLayers2to5(at12);
            const ship = at12.players[0].battlefield[0];
            expect(isCreature(ship)).toBe(true);
            expect(getEffectivePower(at12, ship)).toBe(3);
            expect(getEffectiveToughness(at12, ship)).toBe(5);
        });
    });

    it("Evendo, Waking Haven: the 12+ mana ability exists only at 12+", () => {
        withCompiled(EVENDO, (def) => {
            // The printed "{T}: Add {G}." is the card's own; only the
            // striation's "{G}, {T}: Add {G} for each creature" is gated.
            const gatedAt = (charge: number) => {
                const state = board(def.id, charge);
                const land = state.players[0].battlefield[0];
                const gated = getEffectiveActivatedAbilities(land)
                    .map((e) => e.ability)
                    .filter((a) => a.functionsAtStationCharge === 12);
                expect(gated).toHaveLength(1);
                return activationPreconditionViolation(state, land, gated[0]);
            };
            expect(gatedAt(11)).not.toBe(null);
            expect(gatedAt(12)).toBe(null);
        });
    });
});
