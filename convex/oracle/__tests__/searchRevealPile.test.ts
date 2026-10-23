// Searched pile, another player picks: "Search your library for three cards
// and reveal them. Target opponent chooses one. Put that card into your hand
// and the rest into your graveyard. Then shuffle." — a quantity search (CR
// 701.23d), a reveal that makes the pile public (CR 701.20a), the opponent's
// pick from it, the split, the shuffle (CR 701.24a) — issue #5254.
//
// Layers:
//
//  1. GOLDEN fixture — Intuition compiled whole must produce exactly this
//     Compiled Definition (the one accepted form).
//  2. REFUSALS — the neighbours the cluster names that this rule does not
//     read (a uniqueness constraint on the search, a random pick, another
//     player's library), and the fold's half-runs, so fail-closed is pinned
//     rather than assumed.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Partial<CardDefinition> & Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("Searched pile, an opponent picks — golden fixture (CR 701.23d, CR 701.20a)", () => {
    it("three cards, the pick to hand, the rest to graveyard: Intuition", () => {
        const text =
            "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.";
        expectDefinition(instant("Intuition", "{2}{U}", text), {
            name: "Intuition",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: 3,
                    prompt: "Search your library for three cards.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found1" },
                },
                {
                    op: "choice",
                    kind: "choose-library-card",
                    player: { target: 0 },
                    zoneOwnerId: "controller",
                    zone: "library",
                    candidates: [{ ref: "$found1" }],
                    count: 1,
                    prompt: "Choose one of the revealed cards. Its owner puts that card into their hand and the rest into their graveyard.",
                    bind: "$picked2",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked2" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
        });
    });
});

describe("Searched pile, an opponent picks — refusals", () => {
    const refused: [string, string, string][] = [
        [
            "a uniqueness constraint on the search: Gifts Ungiven",
            "Instant",
            "Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.",
        ],
        [
            "another player's library: Gifts Given",
            "Instant",
            "Search target opponent's library for four cards with different names and reveal them. That player chooses two of those cards. Put the chosen cards into the player's graveyard and the rest into your hand. Then that player shuffles their library.",
        ],
        [
            "different powers, a non-target opponent: Threats Undetected",
            "Sorcery",
            "Search your library for up to four creature cards with different powers and reveal them. An opponent chooses two of those cards. Shuffle the chosen cards into your library and put the rest into your hand.",
        ],
        [
            "land cards with different names: Realms Uncharted",
            "Instant",
            "Search your library for up to four land cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.",
        ],
        [
            "a typed quantity and a random pick: Signal the Clans",
            "Instant",
            "Search your library for three creature cards and reveal them. If you reveal three cards with different names, choose one of them at random and put that card into your hand. Shuffle the rest into your library.",
        ],
        [
            "a pile no one picks from",
            "Instant",
            "Search your library for three cards and reveal them. Then shuffle.",
        ],
        [
            "a pick with no route",
            "Instant",
            "Search your library for three cards and reveal them. Target opponent chooses one. Then shuffle.",
        ],
        [
            "a route with no shuffle",
            "Instant",
            "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard.",
        ],
        [
            "a pick with no pile",
            "Instant",
            "Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.",
        ],
        [
            "a one-card pile",
            "Instant",
            "Search your library for one cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.",
        ],
    ];
    it.each(refused)("refuses %s", (_label, typeLine, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                typeLine,
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
