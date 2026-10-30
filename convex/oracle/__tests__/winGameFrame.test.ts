// "You win the game" Verb Frame and the counted intervening "if" that gates
// it (CR 104.2b, CR 603.4, issue #7550).
//
//  1. GOLDEN fixture — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition (`sortKeys` equality). Smoke-scenario
//     generation covers the `winGame` Op, so no `GOLDEN_FIXTURES` row is owed.
//  2. REFUSALS — the neighbours the frame does not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const EPIC_STRUGGLE =
    "At the beginning of your upkeep, if you control twenty or more creatures, you win the game.";

describe("winGame frame — golden", () => {
    it("Epic Struggle: upkeep trigger, counted intervening if, bare win (CR 104.2b)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Epic Struggle",
                manaCost: "{2}{G}{G}",
                typeLine: "Enchantment",
                oracleText: EPIC_STRUGGLE,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Epic Struggle",
                types: ["Enchantment"],
                manaCost: { X: 2, G: 2 },
                oracleText: EPIC_STRUGGLE,
                compiledTriggeredAbilities: [
                    {
                        id: "epic-struggle-trigger",
                        oracleText: EPIC_STRUGGLE,
                        head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                        condition: {
                            kind: "controls",
                            filter: { types: ["Creature"] },
                            atLeast: 20,
                        },
                        effects: [{ op: "winGame", player: "controller" }],
                    },
                ],
            })
        );
    });
});

describe("winGame frame — refusals", () => {
    const refused: readonly [string, string][] = [
        [
            "a win sentence with a trailing gate (Coalition Victory)",
            "You win the game if you control a land of each basic land type and a creature of each color.",
        ],
        [
            "a replacement win (Laboratory Maniac)",
            "If you would draw a card while your library has no cards in it, you win the game instead.",
        ],
        [
            "a counted condition on the opponent's board",
            "At the beginning of your upkeep, if an opponent controls twenty or more creatures, you win the game.",
        ],
        [
            "a win handed to another player",
            "At the beginning of your upkeep, if you control twenty or more creatures, target opponent wins the game.",
        ],
    ];
    for (const [label, oracleText] of refused)
        it(`refuses ${label}`, () => {
            const outcome = compileCard(
                oracleCard({ oracleText, typeLine: "Enchantment" })
            );
            expect(outcome.state).toBe("unparsed");
        });
});
