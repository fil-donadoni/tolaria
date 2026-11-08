// The Pact's delayed upkeep payment — "At the beginning of your next upkeep,
// pay {2}{B}. If you don't, you lose the game." (CR 603.7a, CR 118.12,
// CR 104.3e, issue #8583) — and the bare "You lose the game" Verb Frame.
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition (`sortKeys` equality). Slaughter Pact's body
//     scenario-izes; Summoner's Pact's coloured tutor does not and carries its
//     `GOLDEN_FIXTURES` row (`grammar/fixtures.ts`).
//  2. REFUSALS — the neighbours the rule does not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const SLAUGHTER_PACT =
    "Destroy target nonblack creature.\nAt the beginning of your next upkeep, pay {2}{B}. If you don't, you lose the game.";
const DELAYED =
    "At the beginning of your next upkeep, pay {2}{B}. If you don't, you lose the game.";

function instant(name: string, oracleText: string, manaCost = "{0}") {
    return compileCard(
        oracleCard({
            name,
            manaCost,
            typeLine: "Instant",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("delayed upkeep payment — golden", () => {
    it("Slaughter Pact: a delayed trigger at the controller's next upkeep, pay or lose (CR 603.7a, CR 118.12)", () => {
        const outcome = instant("Slaughter Pact", SLAUGHTER_PACT);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Slaughter Pact",
                types: ["Instant"],
                manaCost: {},
                oracleText: SLAUGHTER_PACT,
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    excludeColors: ["B"],
                },
                effects: [
                    { op: "destroy", target: { target: 0 } },
                    {
                        op: "delayedTrigger",
                        timing: "next-upkeep",
                        targetPlayer: "controller",
                        oracleText: DELAYED,
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: { X: 2, B: 1 },
                                prompt: "Pay {2}{B}?",
                                bind: "$paid1",
                            },
                            {
                                op: "if",
                                predicate: { not: { binding: "$paid1" } },
                                then: [
                                    { op: "loseGame", player: "controller" },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("One with Death: the bare loss (CR 104.3e)", () => {
        const outcome = instant("One with Death", "You lose the game.", "{B}");
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "One with Death",
                types: ["Instant"],
                manaCost: { B: 1 },
                oracleText: "You lose the game.",
                effects: [{ op: "loseGame", player: "controller" }],
            })
        );
    });
});

describe("delayed upkeep payment — refusals", () => {
    const refused: readonly [string, string][] = [
        [
            "a payment of chosen colours (Guild Pact's wording)",
            "Draw a card.\nAt the beginning of your next upkeep, pay one mana of each of the chosen colors. If you don't, you lose the game.",
        ],
        [
            "a delayed payment with no consequence",
            "Draw a card.\nAt the beginning of your next upkeep, pay {2}{B}.",
        ],
        [
            "a consequence other than losing the game",
            "Draw a card.\nAt the beginning of your next upkeep, pay {2}{B}. If you don't, discard a card.",
        ],
        [
            "a payment with no delayed head",
            "Draw a card. Pay {2}{B}. If you don't, you lose the game.",
        ],
        [
            "any player's next upkeep",
            "Draw a card.\nAt the beginning of the next upkeep, pay {2}{B}. If you don't, you lose the game.",
        ],
        ["a loss handed to another player", "Target opponent loses the game."],
        [
            "a loss with a trailing gate",
            "You lose the game if you control no creatures.",
        ],
    ];
    for (const [label, oracleText] of refused)
        it(`refuses ${label}`, () => {
            expect(instant("Refused", oracleText).state).toBe("unparsed");
        });
});
