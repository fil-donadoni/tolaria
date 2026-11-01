// A trigger's ", then you may <effect>" and the graveyard pick it opens
// (CR 603.5, CR 608.2c, CR 205.3 — issue #7721).
//
//  1. GOLDEN — real corpus cards compiled whole: Pothole Mole (the chain's
//     tail read by the trigger site's optional marker) and Overlord of the
//     Balemurk (the same chain, over a "non-<subtype>" card noun disjoined
//     with a second card noun).
//  2. EQUIVALENCE — the comma form lowers to EXACTLY the script the full-stop
//     form does.
//  3. REFUSALS — the spell site, which has no optional marker, still refuses
//     "then you may"; the library-search frame still refuses "non-<subtype>";
//     a plural card-noun disjunction is still refused.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The first gap of a card the compiler must refuse. */
function refused(card: OracleCard) {
    const outcome = compileCard(card);
    expect(outcome.state).toBe("unparsed");
    return outcome.state === "unparsed" ? outcome.gaps[0] : undefined;
}

const POTHOLE_MOLE: OracleCard = {
    oracleId: "8a8bc537-b69f-441d-a10e-d7f17f2f75bb",
    name: "Pothole Mole",
    manaCost: "{2}{G}",
    typeLine: "Creature — Mole",
    oracleText:
        "When this creature enters, mill three cards, then you may return a land card from your graveyard to your hand. (To mill three cards, put the top three cards of your library into your graveyard.)",
    power: "2",
    toughness: "3",
    layout: "normal",
};

const OVERLORD_OF_THE_BALEMURK: OracleCard = {
    oracleId: "652e87af-7cf0-407f-9fb7-1a630fb8dd47",
    name: "Overlord of the Balemurk",
    manaCost: "{3}{B}{B}",
    typeLine: "Enchantment Creature — Avatar Horror",
    oracleText:
        "Impending 5—{1}{B} (If you cast this spell for its impending cost, it enters with five time counters and isn't a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nWhenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.",
    power: "5",
    toughness: "5",
    layout: "normal",
};

describe("then you may — golden (CR 603.5, CR 608.2c)", () => {
    it("Pothole Mole: mill, then an optional pick of a land card from the graveyard", () => {
        expect(sortKeys(compiled(POTHOLE_MOLE))).toEqual(
            sortKeys({
                name: "Pothole Mole",
                oracleText: POTHOLE_MOLE.oracleText,
                manaCost: { G: 1, X: 2 },
                types: ["Creature"],
                subtypes: ["Mole"],
                power: 2,
                toughness: 3,
                compiledTriggeredAbilities: [
                    {
                        id: "pothole-mole-trigger",
                        oracleText:
                            "When this creature enters, mill three cards, then you may return a land card from your graveyard to your hand.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "mill", player: "controller", count: 3 },
                            {
                                op: "choice",
                                kind: "choose-graveyard-card",
                                player: "controller",
                                zone: "graveyard",
                                filter: { type: "Land" },
                                count: { min: 0, max: 1 },
                                prompt: "You may return a land card from your graveyard to your hand.",
                                bind: "$picked",
                            },
                            {
                                op: "moveZone",
                                cards: { ref: "$picked" },
                                player: "controller",
                                from: "graveyard",
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Overlord of the Balemurk: a non-Avatar creature card OR a planeswalker card (CR 205.3, CR 608.2c)", () => {
        expect(sortKeys(compiled(OVERLORD_OF_THE_BALEMURK))).toEqual(
            sortKeys({
                name: "Overlord of the Balemurk",
                oracleText: OVERLORD_OF_THE_BALEMURK.oracleText,
                manaCost: { B: 2, X: 3 },
                types: ["Enchantment", "Creature"],
                subtypes: ["Avatar", "Horror"],
                power: 5,
                toughness: 5,
                staticAbilities: ["impending 5"],
                impending: {
                    id: "impending",
                    description: "Impending 5—{1}{B}",
                    mana: { B: 1, X: 1 },
                },
                compiledTriggeredAbilities: [
                    {
                        id: "overlord-of-the-balemurk-trigger",
                        oracleText:
                            "Whenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.",
                        head: { kind: "enters-or-attacks" },
                        effects: [
                            { op: "mill", player: "controller", count: 4 },
                            {
                                op: "choice",
                                kind: "choose-graveyard-card",
                                player: "controller",
                                zone: "graveyard",
                                // "non-Avatar" qualifies the creature half
                                // only: one `any` clause per half.
                                filter: {
                                    any: [
                                        {
                                            type: "Creature",
                                            excludeSubtype: "Avatar",
                                        },
                                        { type: "Planeswalker" },
                                    ],
                                },
                                count: { min: 0, max: 1 },
                                prompt: "You may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.",
                                bind: "$picked",
                            },
                            {
                                op: "moveZone",
                                cards: { ref: "$picked" },
                                player: "controller",
                                from: "graveyard",
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("then you may — equal to the full-stop form (CR 608.2c)", () => {
    const effectsOf = (tail: string) =>
        sortKeys(
            compiled(
                oracleCard({
                    name: "Then Probe",
                    oracleText: `When this creature enters, ${tail}`,
                })
            ).compiledTriggeredAbilities![0]!.effects
        );

    it('"mill three cards, then you may return …" = "Mill three cards. You may return …"', () => {
        expect(
            effectsOf(
                "mill three cards, then you may return a land card from your graveyard to your hand."
            )
        ).toEqual(
            effectsOf(
                "mill three cards. You may return a land card from your graveyard to your hand."
            )
        );
    });
});

describe("then you may — refused neighbours (fail-closed)", () => {
    it("a SPELL has no optional marker, so its chain tail does not read one", () => {
        refused(
            oracleCard({
                name: "Then Probe",
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
                oracleText:
                    "Mill three cards, then you may return a land card from your graveyard to your hand.",
            })
        );
    });

    it('the library-search frame still refuses "non-<subtype>"', () => {
        expect(
            refused(
                oracleCard({
                    name: "Then Probe",
                    typeLine: "Sorcery",
                    power: undefined,
                    toughness: undefined,
                    oracleText:
                        "Search your library for a non-Human creature card, reveal it, put it into your hand, then shuffle.",
                })
            )?.attribution?.span
        ).toContain("non-Human");
    });

    it("a plural card-noun disjunction is not a pick this frame reads", () => {
        refused(
            oracleCard({
                name: "Then Probe",
                oracleText:
                    "When this creature enters, return up to two creature cards or planeswalker cards from your graveyard to your hand.",
            })
        );
    });
});
