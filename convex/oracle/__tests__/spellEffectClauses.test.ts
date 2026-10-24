// Spell effect clauses: the long tail of one-sentence forms the premodern
// metagame prints (Grammar Cluster of issue #4573).
//
// Two layers, each watching a different way a clause can go wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: Scry N (CR 701.22a),
//     "the other" on a two-card look (CR 401.4), a mana-value ceiling at the
//     announced X (CR 107.3), the controller of the object just acted on
//     (CR 608.2h), a draw counted over a name (CR 201.2) and the keep-one-of-
//     each-type edict (CR 101.4).
//  2. REFUSALS — the neighbours each rule must NOT read (fail-closed,
//     ADR 0105 § 2): a clause whose referent is not the one object announced
//     and acted on, a window the clause does not fit, an X the card never
//     announces.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function instant(
    name: string,
    manaCost: string,
    oracleText: string,
    typeLine = "Instant"
): OracleCard {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

/** The Compiled Definition of a card the compiler accepts (ready or quarantined). */
function definitionOf(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return sortKeys(outcome.definition);
}

describe("golden: one accepted form per card", () => {
    it("Scry N lowers to scryReorder to the bottom (CR 701.22a)", () => {
        expect(
            definitionOf(instant("Opt", "{U}", "Scry 1.\nDraw a card."))
        ).toEqual(
            sortKeys({
                name: "Opt",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText: "Scry 1.\nDraw a card.",
                effects: [
                    {
                        op: "scryReorder",
                        player: "controller",
                        count: 1,
                        destination: "library-bottom",
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
            })
        );
    });

    it('"and the other on the bottom" of a two-card look (CR 401.4)', () => {
        const text =
            "Look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.";
        expect(
            definitionOf(instant("Sleight of Hand", "{U}", text, "Sorcery"))
        ).toEqual(
            sortKeys({
                name: "Sleight of Hand",
                types: ["Sorcery"],
                manaCost: { U: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "lookDistribute",
                        keepTo: "hand",
                        player: "controller",
                        look: 2,
                        take: 1,
                    },
                ],
            })
        );
    });

    it('"mana value X or less" is a ceiling at the announced X (CR 107.3)', () => {
        const text =
            "Gain control of target creature with mana value X or less.";
        expect(definitionOf(instant("Dominate", "{X}{1}{U}{U}", text))).toEqual(
            sortKeys({
                name: "Dominate",
                types: ["Instant"],
                manaCost: { X: "X", generic: 1, U: 2 },
                oracleText: text,
                effects: [
                    {
                        op: "gainControl",
                        target: { target: 0 },
                        controller: "controller",
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    mvFilter: { max: "X" },
                },
            })
        );
    });

    it('"Its controller" gains life from the exiled creature\'s snapshot (CR 608.2h)', () => {
        const text =
            "Exile target creature. Its controller gains life equal to its power.";
        expect(
            definitionOf(instant("Swords to Plowshares", "{W}", text))
        ).toEqual(
            sortKeys({
                name: "Swords to Plowshares",
                types: ["Instant"],
                manaCost: { W: 1 },
                oracleText: text,
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$that1" },
                    {
                        op: "gainLife",
                        player: { ref: "$that1.controller" },
                        amount: { ref: "$that1.power" },
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it('"That artifact\'s controller" gains life from the destroyed artifact (CR 608.2h)', () => {
        const text =
            "Destroy target artifact. It can't be regenerated. That artifact's controller gains life equal to its mana value.";
        expect(definitionOf(instant("Crumble", "{G}", text))).toEqual(
            sortKeys({
                name: "Crumble",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "destroy",
                        target: { target: 0 },
                        cantBeRegenerated: true,
                        bind: "$that1",
                    },
                    {
                        op: "gainLife",
                        player: { ref: "$that1.controller" },
                        amount: { ref: "$that1.manaValue" },
                    },
                ],
                targetRequirement: { type: "Artifact", count: 1 },
            })
        );
    });

    it("a draw counted over the cards of its own name in every graveyard (CR 201.2)", () => {
        const text =
            "Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.";
        expect(
            definitionOf(instant("Accumulated Knowledge", "{1}{U}", text))
        ).toEqual(
            sortKeys({
                name: "Accumulated Knowledge",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText: text,
                effects: [
                    { op: "draw", player: "controller", count: 1 },
                    {
                        op: "draw",
                        player: "controller",
                        count: {
                            count: {
                                zone: "graveyard",
                                acrossAllPlayers: true,
                                filter: { name: "Accumulated Knowledge" },
                            },
                        },
                    },
                ],
            })
        );
    });

    it("an announced permanent phases out until its controller's untap step (CR 702.26b)", () => {
        const text = "Target artifact, creature, or land phases out.";
        expect(definitionOf(instant("Reality Ripple", "{1}{U}", text))).toEqual(
            sortKeys({
                name: "Reality Ripple",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText: text,
                effects: [{ op: "phaseOut", target: { target: 0 } }],
                targetRequirement: {
                    type: ["Artifact", "Creature", "Land"],
                    count: 1,
                },
            })
        );
    });

    it("keep one permanent of each listed type, sacrifice the rest (CR 101.4)", () => {
        const text =
            "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest.";
        expect(
            definitionOf(instant("Cataclysm", "{2}{W}{W}", text, "Sorcery"))
        ).toEqual(
            sortKeys({
                name: "Cataclysm",
                types: ["Sorcery"],
                manaCost: { X: 2, W: 2 },
                oracleText: text,
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        simultaneous: true,
                        effects: [
                            {
                                op: "chooseCategorized",
                                player: { ref: "$each" },
                                zone: "battlefield",
                                categories: [
                                    {
                                        label: "Artifact",
                                        filter: { type: "Artifact" },
                                    },
                                    {
                                        label: "Creature",
                                        filter: { type: "Creature" },
                                    },
                                    {
                                        label: "Enchantment",
                                        filter: { type: "Enchantment" },
                                    },
                                    { label: "Land", filter: { type: "Land" } },
                                ],
                                onPicked: "keep",
                                sweep: { action: "sacrifice" },
                                prompt: "Choose an artifact, a creature, an enchantment, and a land to keep; the rest are sacrificed.",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("refusals: the neighbours each rule must not read", () => {
    const refused = (card: OracleCard) =>
        expect(compileCard(card).state).toBe("unparsed");

    it('"the other" names the card left of a TWO-card window only', () => {
        refused(
            instant(
                "Test",
                "{U}",
                "Look at the top three cards of your library. Put one of them into your hand and the other on the bottom of your library.",
                "Sorcery"
            )
        );
    });

    it("a mana-value X ceiling on a card that announces no X", () => {
        refused(
            instant(
                "Test",
                "{1}{U}{U}",
                "Gain control of target creature with mana value X or less."
            )
        );
    });

    it('"its controller" after a verb that records no acted-on object', () => {
        refused(
            instant(
                "Test",
                "{W}",
                "Tap target creature. Its controller gains life equal to its power."
            )
        );
    });

    it('"that creature\'s controller" behind a destroyed CREATURE (noun/type mismatch)', () => {
        refused(
            instant(
                "Test",
                "{G}",
                "Destroy target creature. That artifact's controller gains life equal to its mana value."
            )
        );
    });

    it('"its controller" of a card in a graveyard (no controller, CR 109.4)', () => {
        refused(
            instant(
                "Test",
                "{W}",
                "Exile target creature card from a graveyard. Its controller gains life equal to its mana value."
            )
        );
    });

    it('"its controller" loses life: only the gain is fixtured', () => {
        refused(
            instant(
                "Test",
                "{W}",
                "Exile target creature. Its controller loses life equal to its power."
            )
        );
    });

    it('"Draw a card, then draw two cards" is not the counted chain', () => {
        refused(instant("Test", "{1}{U}", "Draw a card, then draw two cards."));
    });

    it('"its controller" behind two announced targets', () => {
        refused(
            instant(
                "Test",
                "{W}",
                "Exile target creature and target artifact. Its controller gains life equal to its power."
            )
        );
    });

    it("a draw counted over a permanent set is not the name count", () => {
        refused(
            instant(
                "Test",
                "{1}{U}",
                "Draw a card, then draw cards equal to the number of Islands you control."
            )
        );
    });

    it("a sweep that phases out is not an announced target", () => {
        refused(instant("Test", "{1}{U}", "Creatures you control phase out."));
        refused(instant("Test", "{1}{U}", "Each creature phases out."));
    });

    it("a well-formed list of only three of the four types", () => {
        refused(
            instant(
                "Test",
                "{2}{W}{W}",
                "Each player chooses from among the permanents they control an artifact, a creature, and a land, then sacrifices the rest.",
                "Sorcery"
            )
        );
    });

    it("an edict listing fewer types than the four printed", () => {
        refused(
            instant(
                "Test",
                "{2}{W}{W}",
                "Each player chooses from among the permanents they control a creature and a land, then sacrifices the rest.",
                "Sorcery"
            )
        );
    });
});
