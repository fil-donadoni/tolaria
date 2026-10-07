// Library reveal: the reveal/dig/pile Ops (CR 701.20a, CR 701.21, CR 400.7,
// issue #4524) — `revealUntilMatch`, `digMatchingToHand`, `divideIntoPiles`.
//
//  1. GOLDEN fixtures — a real corpus card compiled whole, one per accepted form.
//  2. REFUSALS — each half without the other, and the neighbours the corpus
//     prints that this rule does not read (state "unparsed").

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function card(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        ...(typeLine === "Creature"
            ? { power: "1", toughness: "1" }
            : { power: undefined, toughness: undefined }),
    });
}

function compiled(c: ReturnType<typeof card>) {
    const outcome = compileCard(c);
    if (outcome.state === "unparsed")
        throw new Error(`${c.name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

function refused(oracleText: string, typeLine = "Instant") {
    return compileCard(card("Probe", "{U}", typeLine, oracleText)).state;
}

describe("Library reveal — golden fixtures", () => {
    it("reveal + An opponent separates those cards + pile routing (divideIntoPiles): Fact or Fiction", () => {
        const text =
            "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.";
        expect(
            sortKeys(
                compiled(card("Fact or Fiction", "{3}{U}", "Instant", text))
            )
        ).toEqual(
            sortKeys({
                name: "Fact or Fiction",
                types: ["Instant"],
                manaCost: {
                    X: 3,
                    U: 1,
                },
                oracleText:
                    "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.",
                effects: [
                    {
                        op: "divideIntoPiles",
                        objects: {
                            set: "library-top",
                            player: "controller",
                            count: 5,
                        },
                        divider: "opponent",
                        chooser: "controller",
                        dividePrompt:
                            "Separate the revealed cards into two piles.",
                        pickPrompt:
                            "Choose a pile: it goes to your hand, the other to your graveyard.",
                        chosenBind: "$chosenPile",
                        otherBind: "$otherPile",
                        chosenEffect: [
                            {
                                op: "moveZone",
                                cards: {
                                    ref: "$chosenPile",
                                },
                                player: "controller",
                                from: "library",
                                to: "hand",
                            },
                        ],
                        otherEffect: [
                            {
                                op: "moveZone",
                                cards: {
                                    ref: "$otherPile",
                                },
                                player: "controller",
                                from: "library",
                                to: "graveyard",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("separate them into two piles + An opponent chooses one of those piles: Steam Augury", () => {
        const text =
            "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.";
        expect(
            sortKeys(
                compiled(card("Steam Augury", "{1}{U}{R}", "Instant", text))
            )
        ).toEqual(
            sortKeys({
                name: "Steam Augury",
                types: ["Instant"],
                manaCost: {
                    X: 1,
                    U: 1,
                    R: 1,
                },
                oracleText:
                    "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.",
                effects: [
                    {
                        op: "divideIntoPiles",
                        objects: {
                            set: "library-top",
                            player: "controller",
                            count: 5,
                        },
                        divider: "opponent",
                        chooser: "controller",
                        dividePrompt:
                            "Separate the revealed cards into two piles.",
                        pickPrompt:
                            "Choose a pile: it goes to your hand, the other to your graveyard.",
                        chosenBind: "$chosenPile",
                        otherBind: "$otherPile",
                        chosenEffect: [
                            {
                                op: "moveZone",
                                cards: {
                                    ref: "$chosenPile",
                                },
                                player: "controller",
                                from: "library",
                                to: "hand",
                            },
                        ],
                        otherEffect: [
                            {
                                op: "moveZone",
                                cards: {
                                    ref: "$otherPile",
                                },
                                player: "controller",
                                from: "library",
                                to: "graveyard",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reveal the top card into hand + mana-value life loss (digMatchingToHand): Dark Confidant", () => {
        const text =
            "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.";
        expect(
            sortKeys(
                compiled(card("Dark Confidant", "{1}{B}", "Creature", text))
            )
        ).toEqual(
            sortKeys({
                name: "Dark Confidant",
                types: ["Creature"],
                manaCost: {
                    X: 1,
                    B: 1,
                },
                power: 1,
                toughness: 1,
                oracleText:
                    "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
                compiledTriggeredAbilities: [
                    {
                        id: "dark-confidant-trigger",
                        oracleText:
                            "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "your",
                        },
                        effects: [
                            {
                                op: "digMatchingToHand",
                                player: "controller",
                                look: 1,
                                filter: {},
                                destination: "graveyard",
                                bind: "$revealed",
                            },
                            {
                                op: "loseLife",
                                player: "controller",
                                amount: {
                                    manaValue: {
                                        of: {
                                            ref: "$revealed",
                                        },
                                    },
                                },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reveal until a basic land: match to hand, rest to graveyard (revealUntilMatch): Hermit Druid", () => {
        const text =
            "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.";
        expect(
            sortKeys(compiled(card("Hermit Druid", "{1}{G}", "Creature", text)))
        ).toEqual(
            sortKeys({
                name: "Hermit Druid",
                types: ["Creature"],
                manaCost: {
                    X: 1,
                    G: 1,
                },
                power: 1,
                toughness: 1,
                oracleText:
                    "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.",
                activatedAbilities: [
                    {
                        id: "hermit-druid-ability",
                        oracleText:
                            "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.",
                        cost: {
                            mana: {
                                G: 1,
                            },
                            tap: true,
                        },
                        useStack: true,
                        effects: [
                            {
                                op: "revealUntilMatch",
                                player: "controller",
                                filter: {
                                    type: "Land",
                                    supertype: "Basic",
                                },
                                match: "hand",
                                rest: "graveyard",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reveal until a white card: match to hand, rest exiled: Sacred Guide", () => {
        const text =
            "{W}, {T}: Reveal cards from the top of your library until you reveal a white card. Put that card into your hand and exile all other cards revealed this way.";
        expect(
            sortKeys(compiled(card("Sacred Guide", "{2}{W}", "Creature", text)))
        ).toEqual(
            sortKeys({
                name: "Sacred Guide",
                types: ["Creature"],
                manaCost: {
                    X: 2,
                    W: 1,
                },
                power: 1,
                toughness: 1,
                oracleText:
                    "{W}, {T}: Reveal cards from the top of your library until you reveal a white card. Put that card into your hand and exile all other cards revealed this way.",
                activatedAbilities: [
                    {
                        id: "sacred-guide-ability",
                        oracleText:
                            "{W}, {T}: Reveal cards from the top of your library until you reveal a white card. Put that card into your hand and exile all other cards revealed this way.",
                        cost: {
                            mana: {
                                W: 1,
                            },
                            tap: true,
                        },
                        useStack: true,
                        effects: [
                            {
                                op: "revealUntilMatch",
                                player: "controller",
                                filter: {
                                    color: "W",
                                },
                                match: "hand",
                                rest: "exile",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("Library reveal — refusals (fail-closed)", () => {
    const window = "Reveal the top five cards of your library.";
    it("a window with no pile sentences is a look, not a division", () => {
        expect(
            refused(
                `${window} Put one pile into your hand and the other into your graveyard.`
            )
        ).toBe("unparsed");
    });
    it("a pile split of a LOOK (not a reveal) is refused", () => {
        expect(
            refused(
                "Look at the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard."
            )
        ).toBe("unparsed");
    });
    it("a pile split with no routing is refused", () => {
        expect(
            refused(
                `${window} An opponent separates those cards into two piles.`
            )
        ).toBe("unparsed");
    });
    it("the other pile going to the bottom (Jace) is not read", () => {
        expect(
            refused(
                `${window} An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.`
            )
        ).toBe("unparsed");
    });
    it("a reveal-until window with no routing is refused", () => {
        expect(
            refused(
                "Reveal cards from the top of your library until you reveal a creature card.",
                "Sorcery"
            )
        ).toBe("unparsed");
    });
    it("the rest on the bottom of the library (Recross the Paths) is not read", () => {
        expect(
            refused(
                "Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and the rest on the bottom of your library in any order.",
                "Sorcery"
            )
        ).toBe("unparsed");
    });
    it("a conditional routing (Avenging Druid) is not read", () => {
        expect(
            refused(
                "Reveal cards from the top of your library until you reveal a land card. If you do, put that card onto the battlefield and put all other cards revealed this way into your graveyard.",
                "Sorcery"
            )
        ).toBe("unparsed");
    });
    it("a life-loss tail with no revealed card before it is refused", () => {
        expect(
            refused("You lose life equal to its mana value.", "Sorcery")
        ).toBe("unparsed");
    });
    it("a repeat rider (Ad Nauseam) is not read", () => {
        expect(
            refused(
                "Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.",
                "Instant"
            )
        ).toBe("unparsed");
    });
});
