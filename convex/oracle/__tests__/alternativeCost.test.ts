// Alternative cost lines: "You may … rather than pay this spell's mana cost."
// (CR 118.9, issue #4559).
//
// Three layers:
//  1. GOLDEN — a real corpus card compiled whole produces exactly this
//     Compiled Definition (Foil's two-requirement discard, Vine Dryad's
//     colour-pitch exile on a permanent).
//  2. GOLD — the hand-written Foil compiles to the `alternativeCosts` its
//     author wrote.
//  3. REFUSALS — the neighbours the engine has no surface for stay unparsed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { oracleCard, parseContext } from "./oracle.fixture";

const FOIL = oracleCard({
    name: "Foil",
    manaCost: "{2}{U}{U}",
    typeLine: "Instant",
    oracleText:
        "You may discard an Island card and another card rather than pay this spell's mana cost.\nCounter target spell.",
    power: undefined,
    toughness: undefined,
});

const VINE_DRYAD = oracleCard({
    name: "Vine Dryad",
    manaCost: "{3}{G}",
    typeLine: "Creature — Dryad",
    oracleText:
        "Forestwalk\nYou may exile a green card from your hand rather than pay this spell's mana cost.",
    power: "2",
    toughness: "1",
});

const LAND_GRANT = oracleCard({
    name: "Land Grant",
    manaCost: "{1}{G}",
    typeLine: "Sorcery",
    oracleText:
        "If you have no land cards in hand, you may reveal your hand rather than pay this spell's mana cost.\nSearch your library for a Forest card, reveal that card, put it into your hand, then shuffle.",
    power: undefined,
    toughness: undefined,
});

const SPINNING_DARKNESS = oracleCard({
    name: "Spinning Darkness",
    manaCost: "{4}{B}{B}",
    typeLine: "Instant",
    oracleText:
        "You may exile the top three black cards of your graveyard rather than pay this spell's mana cost.\nSpinning Darkness deals 3 damage to target nonblack creature. You gain 3 life.",
    power: undefined,
    toughness: undefined,
});

function definitionOf(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return sortKeys(outcome.definition);
}

describe("alternative cost — golden (CR 118.9)", () => {
    it("Foil: discard an Island card and another card (CR 701.9)", () => {
        expect(definitionOf(FOIL)).toEqual(
            sortKeys({
                name: "Foil",
                types: ["Instant"],
                manaCost: { X: 2, U: 2 },
                oracleText: FOIL.oracleText,
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: { type: "spell", count: 1 },
                alternativeCosts: [
                    {
                        id: "pitch-discard-island-and-card",
                        description: "Discard an Island card and another card",
                        hand: {
                            action: "discard",
                            requirements: [
                                { filter: { subtype: "Island" }, count: 1 },
                                { filter: {}, count: 1 },
                            ],
                        },
                    },
                ],
            })
        );
    });

    it("Vine Dryad: exile a green card from your hand (CR 701.13), on a permanent", () => {
        expect(definitionOf(VINE_DRYAD)).toEqual(
            sortKeys({
                name: "Vine Dryad",
                types: ["Creature"],
                subtypes: ["Dryad"],
                manaCost: { X: 3, G: 1 },
                power: 2,
                toughness: 1,
                oracleText: VINE_DRYAD.oracleText,
                staticAbilities: ["forestwalk"],
                alternativeCosts: [
                    {
                        id: "pitch-exile-green",
                        description: "Exile a green card from your hand",
                        hand: {
                            action: "exile",
                            requirements: [
                                { filter: { color: "G" }, count: 1 },
                            ],
                        },
                    },
                ],
            })
        );
    });

    it("Spinning Darkness: exile the top three black cards of your graveyard (CR 701.13, 404.2)", () => {
        expect(definitionOf(SPINNING_DARKNESS)).toEqual(
            sortKeys({
                name: "Spinning Darkness",
                types: ["Instant"],
                manaCost: { X: 4, B: 2 },
                oracleText: SPINNING_DARKNESS.oracleText,
                effects: [
                    { op: "dealDamage", amount: 3, to: { target: 0 } },
                    { op: "gainLife", player: "controller", amount: 3 },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    excludeColors: ["B"],
                },
                alternativeCosts: [
                    {
                        id: "exile-top-three-black",
                        description:
                            "Exile the top three black cards of your graveyard",
                        graveyard: {
                            action: "exile",
                            filter: { color: "B" },
                            count: 3,
                            position: "top",
                        },
                    },
                ],
            })
        );
    });

    it("Land Grant: reveal your hand, gated on no land cards in hand (CR 701.20a)", () => {
        const def = definitionOf(LAND_GRANT);
        expect(def).toMatchObject({
            name: "Land Grant",
            alternativeCosts: [
                {
                    id: "reveal-hand-no-land-cards",
                    description: "Reveal your hand",
                    condition: {
                        kind: "no-hand-cards",
                        filter: { type: "Land" },
                    },
                    revealHand: true,
                },
            ],
        });
    });

    it("a blue pitch line on a spell reads the same shape (Misdirection)", () => {
        const routed = routeLine(
            "You may exile a blue card from your hand rather than pay this spell's mana cost.",
            parseContext(FOIL)
        );
        expect(routed.ok).toBe(true);
        if (routed.ok)
            expect(routed.value.ir).toEqual({
                kind: "alternative-cost",
                cost: {
                    id: "pitch-exile-blue",
                    description: "Exile a blue card from your hand",
                    hand: {
                        action: "exile",
                        requirements: [{ filter: { color: "U" }, count: 1 }],
                    },
                },
            });
    });
});

describe("alternative cost — refusals (fail-closed)", () => {
    const REFUSED: readonly [string, string][] = [
        [
            "graveyard exile leg over a card type, not the topmost of a colour",
            "You may exile three creature cards from your graveyard rather than pay this spell's mana cost.",
        ],
        [
            "graveyard exile leg with a singular count against the plural noun",
            "You may exile the top one black cards of your graveyard rather than pay this spell's mana cost.",
        ],
        [
            "graveyard exile leg from the opponent's graveyard",
            "You may exile the top three black cards of target opponent's graveyard rather than pay this spell's mana cost.",
        ],
        [
            "reveal over a colour, not a card type",
            "If you have no red cards in hand, you may reveal your hand rather than pay this spell's mana cost.",
        ],
        [
            "reveal with no hand-contents condition",
            "You may reveal your hand rather than pay this spell's mana cost.",
        ],
        [
            "life plus pitch — a different printed form",
            "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.",
        ],
        [
            "turn-gated pitch — a different printed form",
            "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.",
        ],
        [
            "not a colour word",
            "You may exile a purple card from your hand rather than pay this spell's mana cost.",
        ],
    ];

    for (const [label, line] of REFUSED)
        it(label, () => {
            expect(routeLine(line, parseContext(FOIL)).ok).toBe(false);
        });
});
