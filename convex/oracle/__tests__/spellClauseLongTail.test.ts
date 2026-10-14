// Spell long tail 2 (issue #4574): three clause forms a Grammar Cluster closed
// together, each with its real corpus card compiled whole and compared with
// `sortKeys` equality, plus the neighbours the corpus prints that must stay
// refused (fail-closed, ADR 0105 § 2).
//
//  1. "You gain life equal to the number of creature cards in your graveyard"
//     (Blossoming Wreath, CR 107.1 + CR 119.3 + CR 404.1) — a counted set in
//     the controller's graveyard, read as `gainLife { count }`.
//  2. "{self} deals damage to each player equal to twice the number of
//     nonbasic lands that player controls" (Price of Progress, CR 120.1 +
//     CR 107.1 + CR 205.4a) — a `forEach` over the players, each dealt a count
//     of THEIR OWN lands.
//  3. "Create X 4/4 white Angel creature tokens with flying." (Decree of
//     Justice, CR 107.3 + CR 111.1) — the announced X is the token count.

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
        typeLine,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(source: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(source);
    if (outcome.state === "unparsed")
        throw new Error(
            `${source.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const refused = (source: ReturnType<typeof oracleCard>) =>
    compileCard(source).state === "unparsed";

describe("counted graveyard life (CR 107.1 + CR 404.1, issue #4574)", () => {
    const TEXT =
        "You gain life equal to the number of creature cards in your graveyard.";

    it("Blossoming Wreath: life equal to the creature cards in your graveyard", () => {
        expect(
            sortKeys(
                compiled(card("Blossoming Wreath", "{G}", "Instant", TEXT))
            )
        ).toEqual(
            sortKeys({
                name: "Blossoming Wreath",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText: TEXT,
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: {
                            count: {
                                zone: "graveyard",
                                controller: "controller",
                                filter: { type: ["Creature"] },
                            },
                        },
                    },
                ],
            })
        );
    });

    it.each([
        [
            "another player's graveyard",
            "You gain life equal to the number of creature cards in target player's graveyard.",
        ],
        [
            "every graveyard",
            "You gain life equal to the number of creature cards in all graveyards.",
        ],
        [
            "a clause the count cannot express",
            "You gain life equal to the number of tapped creature cards in your graveyard.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(refused(card("Wreath Neighbour", "{G}", "Instant", text))).toBe(
            true
        );
    });
});

describe("damage to each player by their own count (CR 120.1, issue #4574)", () => {
    const TEXT =
        "Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.";

    it("Price of Progress: a forEach over players, each dealt twice their nonbasic lands", () => {
        expect(
            sortKeys(
                compiled(card("Price of Progress", "{1}{R}", "Instant", TEXT))
            )
        ).toEqual(
            sortKeys({
                name: "Price of Progress",
                types: ["Instant"],
                manaCost: { X: 1, R: 1 },
                oracleText: TEXT,
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: {
                                    count: {
                                        zone: "battlefield",
                                        controller: { ref: "$each" },
                                        filter: {
                                            type: ["Land"],
                                            excludeSupertype: "Basic",
                                        },
                                        times: 2,
                                    },
                                },
                                to: { player: { ref: "$each" } },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it.each([
        [
            "a count that is not per recipient",
            "Price of Progress deals damage to each player equal to twice the number of nonbasic lands you control.",
        ],
        [
            "a multiplier other than twice",
            "Price of Progress deals damage to each player equal to the number of nonbasic lands that player controls.",
        ],
        [
            "an opponent-only recipient",
            "Price of Progress deals damage to each opponent equal to twice the number of nonbasic lands that player controls.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(
            refused(card("Price Neighbour", "{1}{R}", "Instant", text))
        ).toBe(true);
    });
});

describe("announced-X token count (CR 107.3 + CR 111.1, issue #4574)", () => {
    const TEXT = "Create X 4/4 white Angel creature tokens with flying.";

    it("Decree of Justice: createToken counts the announced X", () => {
        const { effects } = compiled(
            card(
                "Decree of Justice",
                "{X}{X}{2}{W}{W}",
                "Sorcery",
                `${TEXT}\nCycling {2}{W} ({2}{W}, Discard this card: Draw a card.)\nWhen you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.`
            )
        );
        expect(sortKeys(effects)).toEqual(
            sortKeys([
                {
                    op: "createToken",
                    token: {
                        name: "Angel",
                        types: ["Creature"],
                        subtypes: ["Angel"],
                        power: 4,
                        toughness: 4,
                        colors: ["W"],
                        staticAbilities: ["flying"],
                    },
                    controller: "controller",
                    count: { X: true },
                },
            ])
        );
    });

    it.each([
        [
            "an X count on a spell that announces no X",
            card("No X Spell", "{3}{W}", "Sorcery", TEXT),
        ],
        [
            "an artifact token",
            card(
                "Artifact X",
                "{X}{W}",
                "Sorcery",
                "Create X 1/1 colorless Servo artifact creature tokens."
            ),
        ],
        [
            "a singular token with an X count",
            card(
                "Singular X",
                "{X}{W}",
                "Sorcery",
                "Create X 4/4 white Angel creature token with flying."
            ),
        ],
    ])("refuses %s", (_label, source) => {
        expect(refused(source)).toBe(true);
    });
});
